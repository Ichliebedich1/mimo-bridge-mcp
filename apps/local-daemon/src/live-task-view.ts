import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";
import type { TaskStore } from "../../../src/services/task-store.js";
import { createEventParser } from "../../../src/services/event-parser.js";
import { parseReasonixSessionTail } from "../../../src/services/reasonix-event-parser.js";

export interface LiveEvent {
  timestamp: string;
  event_type: string;
  kind: "message" | "tool" | "event";
  tool?: string;
  status?: string;
  summary: string;
}

export interface LiveTaskView {
  task_id: string;
  agent: string;
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
    return { error: "task not found" };
  }

  const isLive = task.status === "running";
  const logRounds = findLogRounds(taskStore, taskId, task.current_round);
  const displayRound = isLive ? task.current_round : logRounds[logRounds.length - 1] ?? task.current_round;
  const logPaths = logRounds.map((round) => taskStore.getLogPath(taskId, round));

  if (logPaths.length === 0) {
    const reasonixOnly = task.agent === "reasonix-tui" && task.agent_session_path
      ? parseReasonixSessionTail(task.agent_session_path, maxEvents, maxChars)
      : { events: [], truncated: false };
    return {
      task_id: task.task_id,
      agent: task.agent,
      status: task.status,
      current_round: displayRound,
      updated_at: task.updated_at,
      is_live: isLive,
      events: reasonixOnly.events,
      truncated: reasonixOnly.truncated,
    };
  }

  const result = readMergedLiveEvents(task.agent, task.agent_session_path, logPaths, maxEvents, maxChars);

  return {
    task_id: task.task_id,
    agent: task.agent,
    status: task.status,
    current_round: displayRound,
    updated_at: task.updated_at,
    is_live: isLive,
    events: result.events,
    truncated: result.truncated,
  };
}

function readMergedLiveEvents(
  agent: string,
  agentSessionPath: string | null | undefined,
  logPaths: string[],
  maxEvents: number,
  maxChars: number,
): { events: LiveEvent[]; truncated: boolean } {
  const runtimeResult = readTailEventsFromPaths(logPaths, maxEvents, maxChars);
  if (agent !== "reasonix-tui" || !agentSessionPath) {
    return agent === "reasonix-tui"
      ? { events: filterReasonixRuntimeEvents(runtimeResult.events), truncated: runtimeResult.truncated }
      : runtimeResult;
  }

  const sessionResult = parseReasonixSessionTail(agentSessionPath, maxEvents, maxChars);
  if (sessionResult.events.length === 0) {
    const runtimeEvents = filterReasonixRuntimeEvents(runtimeResult.events);
    return {
      events: runtimeEvents,
      truncated: runtimeResult.truncated || sessionResult.truncated,
    };
  }

  const runtimeEvents = filterReasonixRuntimeEvents(runtimeResult.events).filter((event) => event.kind === "tool");
  return boundLiveEvents(
    dedupeLiveEvents([...runtimeEvents, ...sessionResult.events])
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    maxEvents,
    maxChars,
    runtimeResult.truncated || sessionResult.truncated,
  );
}

function filterReasonixRuntimeEvents(events: LiveEvent[]): LiveEvent[] {
  return events.filter((event) => {
    if (event.kind === "tool") return true;
    const type = event.event_type.toLowerCase();
    const summary = event.summary.trim();
    if (type.includes("stderr")) return true;
    if (/reasonix tui task (started|completed|failed)/i.test(summary)) return true;
    if (/reasonix \[session\] mapped/i.test(summary)) return true;
    if (/agent\.max_steps|paused after/i.test(summary)) return true;
    return false;
  });
}

function findLogRounds(taskStore: TaskStore, taskId: string, currentRound: number): number[] {
  const rounds: number[] = [];
  for (let round = 1; round <= Math.max(1, currentRound); round++) {
    if (existsSync(taskStore.getLogPath(taskId, round))) {
      rounds.push(round);
    }
  }
  return rounds;
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

    const parser = createEventParser();
    parser.parse(content);
    const result = parser.flush();

    const parsed: LiveEvent[] = [];
    for (const record of result.events) {
      const event = parseLiveEventRecord(record as unknown);
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

function readTailEventsFromPaths(
  filePaths: string[],
  maxEvents: number,
  maxChars: number,
): { events: LiveEvent[]; truncated: boolean } {
  if (filePaths.length === 0) {
    return { events: [], truncated: false };
  }

  const events: LiveEvent[] = [];
  let truncated = false;
  for (const filePath of filePaths) {
    const result = readTailEvents(filePath, maxEvents, maxChars);
    events.push(...result.events);
    truncated = truncated || result.truncated;
  }

  return boundLiveEvents(
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    maxEvents,
    maxChars,
    truncated,
  );
}

function dedupeLiveEvents(events: LiveEvent[]): LiveEvent[] {
  const seen = new Set<string>();
  const result: LiveEvent[] = [];
  for (const event of events) {
    const key = [
      event.event_type,
      event.kind,
      event.tool ?? "",
      event.status ?? "",
      event.summary,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

function boundLiveEvents(
  events: LiveEvent[],
  maxEvents: number,
  maxChars: number,
  alreadyTruncated: boolean,
): { events: LiveEvent[]; truncated: boolean } {
  const recent = events.slice(-maxEvents);
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
  return { events: bounded, truncated: alreadyTruncated || charTruncated || events.length > recent.length };
}

export function parseJsonlLine(line: string): LiveEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  return parseLiveEventRecord(parsed);
}

function parseLiveEventRecord(parsed: unknown): LiveEvent | null {
  if (!isRecord(parsed)) {
    return null;
  }
  if (isLowValueMimoStep(parsed)) {
    return null;
  }

  const rawType = typeof parsed.type === "string" ? parsed.type : "unknown";
  const timestamp = extractTimestamp(parsed);
  const summary = sanitizeLiveText(extractSummary(parsed));
  const kind = classifyEvent(parsed);

  if (containsBlockedContent(summary)) {
    return {
      timestamp,
      event_type: sanitizeEventType(rawType),
      kind,
      summary: "(content filtered)",
    };
  }

  const event: LiveEvent = {
    timestamp,
    event_type: sanitizeEventType(rawType),
    kind,
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

  if (isToolEvent(record)) {
    return extractToolSummary(record);
  }

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

function extractToolSummary(record: Record<string, unknown>): string {
  const part = isRecord(record.part) ? record.part : {};
  const state = isRecord(part.state) ? part.state : {};
  const chunks: string[] = [];
  const toolName = extractToolName(record);
  let hasNarrativeSummary = false;

  if (typeof state.title === "string") {
    chunks.push(state.title);
    hasNarrativeSummary = true;
  } else if (isRecord(state.input) && typeof state.input.description === "string") {
    chunks.push(state.input.description);
    hasNarrativeSummary = true;
  }

  const inputSummary = hasNarrativeSummary ? "" : summarizeToolInput(state.input);
  if (inputSummary) {
    chunks.push("input: " + inputSummary);
  }

  const output = extractToolOutput(state);
  const outputSummary = hasNarrativeSummary && !isShellTool(toolName) ? "" : summarizeToolOutput(toolName, output);
  if (outputSummary) {
    chunks.push("output: " + outputSummary);
  }

  return chunks.length > 0 ? chunks.join("\n") : "[" + (toolName ?? "tool") + "]";
}

function extractToolOutput(state: Record<string, unknown>): string | undefined {
  if (typeof state.output === "string") return state.output;
  if (typeof state.error === "string") return state.error;
  if (isRecord(state.metadata) && typeof state.metadata.output === "string") return state.metadata.output;
  return undefined;
}

function summarizeToolInput(input: unknown): string {
  if (typeof input === "string") {
    return truncateInline(input, 300);
  }
  if (!isRecord(input)) {
    return "";
  }

  const preferredKeys = [
    "command",
    "filePath",
    "path",
    "pattern",
    "include",
    "glob",
    "query",
    "description",
    "oldString",
    "newString",
  ];
  const parts: string[] = [];

  for (const key of preferredKeys) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value === "string") {
      if (key === "filePath" || key === "path") {
        parts.push(`${key}=${safeBasename(value)}`);
      } else if (key === "oldString" || key === "newString") {
        parts.push(`${key}=${value.length} chars`);
      } else {
        parts.push(`${key}=${truncateInline(value, 220)}`);
      }
    } else if (value !== undefined) {
      parts.push(`${key}=${truncateInline(JSON.stringify(value) ?? String(value), 220)}`);
    }
  }

  if (parts.length > 0) {
    return parts.join("; ");
  }

  return truncateInline(JSON.stringify(input) ?? String(input), 300);
}

function summarizeToolOutput(toolName: string | undefined, output: string | undefined): string {
  if (!output) {
    return "";
  }

  const normalizedTool = (toolName ?? "").toLowerCase();
  if ((normalizedTool === "read" || normalizedTool === "file_read") && output.includes("<content>")) {
    return `file content omitted (${output.length} chars)`;
  }

  const text = output.replace(/\r/g, "");
  return truncateBlock(text, normalizedTool === "bash" || normalizedTool === "shell" ? 1600 : 700);
}

function isShellTool(toolName: string | undefined): boolean {
  const normalized = (toolName ?? "").toLowerCase();
  return normalized === "bash" || normalized === "shell" || normalized === "powershell" || normalized === "cmd";
}

function extractTool(record: Record<string, unknown>): string | undefined {
  const toolName = extractToolName(record);
  return toolName ? sanitizeField(toolName, 48) : undefined;
}

function extractToolName(record: Record<string, unknown>): string | undefined {
  if (isRecord(record.part) && typeof record.part.tool === "string") {
    return record.part.tool;
  }
  if (typeof record.tool === "string") return record.tool;
  if (typeof record.tool_name === "string") return record.tool_name;
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
  const maxSummary = 2000;
  if (summary.length <= maxSummary) return summary;
  return summary.slice(0, maxSummary) + "\n[truncated]";
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

function classifyEvent(record: Record<string, unknown>): LiveEvent["kind"] {
  if (isToolEvent(record)) return "tool";
  if (record.type === "text") return "message";
  if (isRecord(record.part) && record.part.type === "text") return "message";
  return "event";
}

function isToolEvent(record: Record<string, unknown>): boolean {
  if (extractToolName(record) !== undefined) return true;
  return record.type === "tool_use" && isRecord(record.part) && isRecord(record.part.state);
}

function isLowValueMimoStep(record: Record<string, unknown>): boolean {
  if (!isRecord(record.part)) return false;
  return record.part.type === "step-start" || record.part.type === "step-finish";
}

function safeBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const name = basename(normalized);
  return name || "[local path]";
}

function truncateInline(value: string, maxLen: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen) + " [truncated]";
}

function truncateBlock(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "\n[truncated]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
