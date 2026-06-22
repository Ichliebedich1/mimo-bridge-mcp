import { openSync, fstatSync, readSync, closeSync, existsSync } from "node:fs";
import type { TaskStore } from "../../../src/services/task-store.js";

export interface LiveEvent {
  timestamp: string;
  event_type: string;
  tool?: string;
  status?: string;
  summary: string;
}

export interface LiveTaskView {
  task_id: string;
  status: string;
  current_round: number;
  updated_at: string;
  is_live: boolean;
  events: LiveEvent[];
  truncated: boolean;
}

const MAX_EVENTS_HARD = 100;
const MAX_EVENTS_DEFAULT = 40;
const MAX_CHARS_HARD = 20000;
const MAX_CHARS_DEFAULT = 8000;

const ABSOLUTE_BYTE_CAP = 512 * 1024;
const CHUNK_SIZE = 8192;

const BLOCKED_SUMMARY_PATTERNS: RegExp[] = [
  /[A-Z]:\\[^\s"']*/i,
  /\/(?:home|tmp|var|usr|opt)\/[^\s"']*/i,
  /stdin|session_id|sessionID/i,
];

export function parseLiveParams(params: URLSearchParams): {
  max_events: number;
  max_chars: number;
} {
  const rawEvents = Number(params.get("max_events"));
  const max_events = Number.isInteger(rawEvents) && rawEvents >= 1 && rawEvents <= MAX_EVENTS_HARD
    ? rawEvents
    : MAX_EVENTS_DEFAULT;

  const rawChars = Number(params.get("max_chars"));
  const max_chars = Number.isInteger(rawChars) && rawChars >= 1000 && rawChars <= MAX_CHARS_HARD
    ? rawChars
    : MAX_CHARS_DEFAULT;

  return { max_events, max_chars };
}

export function readLiveTaskView(
  taskStore: TaskStore,
  taskId: string,
  maxEvents: number,
  maxChars: number,
): LiveTaskView | { error: string } {
  const task = taskStore.getTask(taskId);
  if (!task) {
    return { error: "任务不存在" };
  }

  const isLive = task.status === "running";
  const logRound = findLogRound(taskStore, taskId, task.current_round, isLive);
  const logPath = taskStore.getLogPath(taskId, logRound);

  if (!existsSync(logPath)) {
    return {
      task_id: task.task_id,
      status: task.status,
      current_round: logRound,
      updated_at: task.updated_at,
      is_live: isLive,
      events: [],
      truncated: false,
    };
  }

  const result = readTailEvents(logPath, maxEvents, maxChars);

  return {
    task_id: task.task_id,
    status: task.status,
    current_round: logRound,
    updated_at: task.updated_at,
    is_live: isLive,
    events: result.events,
    truncated: result.truncated,
  };
}

function findLogRound(taskStore: TaskStore, taskId: string, currentRound: number, isLive: boolean): number {
  if (isLive) {
    return currentRound;
  }
  for (let round = currentRound; round >= 1; round--) {
    if (existsSync(taskStore.getLogPath(taskId, round))) {
      return round;
    }
  }
  return currentRound;
}

export function parseJsonlTail(
  filePath: string,
  maxEvents: number,
  maxChars: number,
): { events: LiveEvent[]; truncated: boolean } {
  return readTailEvents(filePath, maxEvents, maxChars);
}

function readTailEvents(
  filePath: string,
  maxEvents: number,
  maxChars: number,
): { events: LiveEvent[]; truncated: boolean } {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return { events: [], truncated: false };
  }

  try {
    const stat = fstatSync(fd);
    const fileSize = stat.size;
    if (fileSize === 0) {
      return { events: [], truncated: false };
    }

    const requestedByteCap = Math.max(CHUNK_SIZE, maxChars * 8, maxEvents * 2048);
    const byteCap = Math.min(fileSize, requestedByteCap, ABSOLUTE_BYTE_CAP);
    const buffers: Buffer[] = [];
    let totalRead = 0;
    let position = fileSize;

    while (position > 0 && totalRead < byteCap) {
      const toRead = Math.min(CHUNK_SIZE, position, byteCap - totalRead);
      position -= toRead;
      const buf = Buffer.alloc(toRead);
      readSync(fd, buf, 0, toRead, position);
      buffers.push(buf);
      totalRead += toRead;
    }

    buffers.reverse();
    let content = Buffer.concat(buffers).toString("utf-8");
    const fileTruncated = position > 0;
    if (fileTruncated) {
      const firstCompleteLine = content.indexOf("\n");
      content = firstCompleteLine >= 0 ? content.slice(firstCompleteLine + 1) : "";
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

    const parsed: LiveEvent[] = [];
    for (const line of lines) {
      const event = parseJsonlLine(line);
      if (event) {
        parsed.push(event);
      }
    }

    const recent = parsed.slice(-maxEvents);

    let charCount = 0;
    let charTruncated = false;
    const bounded: LiveEvent[] = [];

    for (let i = recent.length - 1; i >= 0; i--) {
      const event = recent[i];
      const eventChars = JSON.stringify(event).length;
      if (charCount + eventChars > maxChars && bounded.length > 0) {
        charTruncated = true;
        break;
      }
      bounded.push(event);
      charCount += eventChars;
    }

    bounded.reverse();

    return { events: bounded, truncated: fileTruncated || charTruncated };
  } finally {
    closeSync(fd);
  }
}

export function parseJsonlLine(line: string): LiveEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const rawType = typeof parsed.type === "string" ? parsed.type : "unknown";
  const timestamp = extractTimestamp(parsed);
  const summary = sanitizeLiveText(extractSummary(parsed));

  if (containsBlockedContent(summary)) {
    return {
      timestamp,
      event_type: sanitizeEventType(rawType),
      summary: "(内容已过滤)",
    };
  }

  const event: LiveEvent = {
    timestamp,
    event_type: sanitizeEventType(rawType),
    summary: truncateSummary(summary),
  };

  const tool = extractTool(parsed);
  if (tool) {
    event.tool = tool;
  }

  const status = extractStatus(parsed);
  if (status) {
    event.status = status;
  }

  return event;
}

function extractTimestamp(record: Record<string, unknown>): string {
  const ts = record.timestamp ?? record.ts ?? record.time;
  if (typeof ts === "number") {
    return new Date(ts).toISOString();
  }
  if (typeof ts === "string") {
    const date = new Date(ts);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

function extractSummary(record: Record<string, unknown>): string {
  if (typeof record.summary === "string") return record.summary;
  if (typeof record.message === "string") return record.message;

  if (isRecord(record.part)) {
    const part = record.part;
    if (isRecord(part.state)) {
      const state = part.state;
      if (typeof state.title === "string") return state.title;
      if (isRecord(state.input) && typeof state.input.description === "string") return state.input.description;
      if (typeof state.output === "string") return state.output;
      if (isRecord(state.metadata) && typeof state.metadata.output === "string") return state.metadata.output;
      if (typeof state.error === "string") return state.error;
    }
    if (typeof part.text === "string") return part.text;
    if (typeof part.type === "string") return `[${part.type}]`;
  }

  if (typeof record.type === "string") return `[${record.type}]`;
  return "[event]";
}

function extractTool(record: Record<string, unknown>): string | undefined {
  if (isRecord(record.part) && typeof record.part.tool === "string") {
    return sanitizeField(record.part.tool, 48);
  }
  if (typeof record.tool === "string") return sanitizeField(record.tool, 48);
  if (typeof record.tool_name === "string") return sanitizeField(record.tool_name, 48);
  return undefined;
}

function extractStatus(record: Record<string, unknown>): string | undefined {
  if (isRecord(record.part) && isRecord(record.part.state) && typeof record.part.state.status === "string") {
    return sanitizeField(record.part.state.status, 32);
  }
  if (typeof record.status === "string") return sanitizeField(record.status, 32);
  return undefined;
}

function sanitizeField(value: string, maxLen: number): string {
  return value.replace(/[^a-zA-Z0-9_.\-\/]/g, "_").slice(0, maxLen);
}

function sanitizeEventType(type: string): string {
  return type.replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(0, 64);
}

function truncateSummary(summary: string): string {
  const MAX_SUMMARY = 1000;
  if (summary.length <= MAX_SUMMARY) return summary;
  return summary.slice(0, MAX_SUMMARY) + "…";
}

function containsBlockedContent(summary: string): boolean {
  return BLOCKED_SUMMARY_PATTERNS.some((pattern) => pattern.test(summary));
}

function sanitizeLiveText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[A-Z]:\\[^\r\n"']*/gi, "[local path]")
    .replace(/\/(?:home|tmp|var|usr|opt)\/[^\s"']*/gi, "[local path]")
    .replace(/\bses_[A-Za-z0-9_-]+\b/g, "[session]")
    .replace(/\bsession(?:_id|ID)?\b/gi, "[session]")
    .replace(/\bstdin\b/gi, "[stdin]")
    .replace(/\b(?:secret[_-]?)?token[_:-]?[A-Za-z0-9_.-]+\b/gi, "[redacted-token]")
    .replace(/\bpassword\b\s*[:=]\s*\S+/gi, "password=[redacted]")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
