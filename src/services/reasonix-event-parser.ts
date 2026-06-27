import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { basename } from "node:path";

export interface ReasonixLiveEvent {
  timestamp: string;
  event_type: string;
  kind: "message" | "tool" | "event";
  tool?: string;
  status?: string;
  summary: string;
}

export interface ReasonixTokenUsageSummary {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number | null;
  cache_read_tokens: number;
  cache_write_tokens: number;
  events_count: number;
}

const ABSOLUTE_BYTE_CAP = 512 * 1024;
const CHUNK_SIZE = 8192;
const MAX_SUMMARY_CHARS = 2000;

export function parseReasonixSessionLine(
  line: string,
  fallbackTimestampMs = Date.now(),
): ReasonixLiveEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return parseReasonixSessionRecord(parsed, fallbackTimestampMs);
}

export function parseReasonixSessionTail(
  filePath: string | null | undefined,
  maxEvents: number,
  maxChars: number,
): { events: ReasonixLiveEvent[]; truncated: boolean } {
  if (!filePath || !existsSync(filePath)) {
    return { events: [], truncated: false };
  }

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
    const parsed: ReasonixLiveEvent[] = [];
    const baseTimestampMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : Date.now();

    lines.forEach((line, index) => {
      parsed.push(...parseReasonixSessionLine(line, baseTimestampMs + index));
    });

    return boundEvents(parsed, maxEvents, maxChars, fileTruncated);
  } finally {
    closeSync(fd);
  }
}

export function extractReasonixTokenUsageFromFile(filePath: string | null | undefined): ReasonixTokenUsageSummary {
  if (!filePath || !existsSync(filePath)) {
    return emptyTokenUsage();
  }

  let content: string;
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return emptyTokenUsage();
  }

  try {
    const stat = fstatSync(fd);
    const maxBytes = Math.min(stat.size, ABSOLUTE_BYTE_CAP);
    const buf = Buffer.alloc(maxBytes);
    readSync(fd, buf, 0, maxBytes, Math.max(0, stat.size - maxBytes));
    content = buf.toString("utf-8");
  } catch {
    return emptyTokenUsage();
  } finally {
    closeSync(fd);
  }

  const usage = emptyTokenUsage();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const eventUsage = extractReasonixTokenUsageFromRecord(parsed);
    if (eventUsage.events_count === 0) {
      continue;
    }
    usage.input_tokens += eventUsage.input_tokens;
    usage.output_tokens += eventUsage.output_tokens;
    usage.total_tokens += eventUsage.total_tokens;
    usage.cache_read_tokens += eventUsage.cache_read_tokens;
    usage.cache_write_tokens += eventUsage.cache_write_tokens;
    if (eventUsage.estimated_cost !== null) {
      usage.estimated_cost = (usage.estimated_cost ?? 0) + eventUsage.estimated_cost;
    }
    usage.events_count += eventUsage.events_count;
  }

  return usage;
}

function parseReasonixSessionRecord(parsed: unknown, fallbackTimestampMs: number): ReasonixLiveEvent[] {
  if (!isRecord(parsed)) {
    return [];
  }

  const role = typeof parsed.role === "string" ? parsed.role.toLowerCase() : "";
  const timestamp = extractTimestamp(parsed, fallbackTimestampMs);
  const events: ReasonixLiveEvent[] = [];

  if (role === "user" || role === "system") {
    return [];
  }

  if (role === "assistant") {
    const content = extractVisibleContent(parsed.content);
    if (content) {
      events.push({
        timestamp,
        event_type: "reasonix_assistant",
        kind: "message",
        summary: truncateSummary(sanitizeReasonixText(content)),
      });
    }

    const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
    for (const call of toolCalls) {
      const event = parseReasonixToolCall(call, timestamp);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  if (role === "tool") {
    const toolName = typeof parsed.name === "string" ? parsed.name : undefined;
    const content = extractVisibleContent(parsed.content);
    if (!content && !toolName) {
      return [];
    }
    return [
      {
        timestamp,
        event_type: "reasonix_tool_result",
        kind: "tool",
        tool: toolName ? sanitizeField(toolName, 48) : undefined,
        status: "completed",
        summary: summarizeToolOutput(toolName, content),
      },
    ];
  }

  if (typeof parsed.type === "string") {
    const text = extractVisibleContent(parsed.text) || extractVisibleContent(parsed.content);
    if (!text) {
      return [];
    }
    return [
      {
        timestamp,
        event_type: sanitizeEventType(`reasonix_${parsed.type}`),
        kind: parsed.type === "message" || parsed.type === "text" ? "message" : "event",
        summary: truncateSummary(sanitizeReasonixText(text)),
      },
    ];
  }

  return [];
}

function extractReasonixTokenUsageFromRecord(parsed: unknown): ReasonixTokenUsageSummary {
  if (!isRecord(parsed)) {
    return emptyTokenUsage();
  }

  const candidates: unknown[] = [
    parsed.tokens,
    parsed.usage,
    parsed.token_usage,
    parsed.response_usage,
  ];
  if (isRecord(parsed.metadata)) {
    candidates.push(parsed.metadata.tokens, parsed.metadata.usage, parsed.metadata.token_usage);
  }

  for (const candidate of candidates) {
    const usage = parseTokenUsageObject(candidate, parsed);
    if (usage.events_count > 0) {
      return usage;
    }
  }

  const direct = parseTokenUsageObject(parsed, parsed);
  return direct;
}

function parseTokenUsageObject(value: unknown, costSource: unknown): ReasonixTokenUsageSummary {
  if (!isRecord(value)) {
    return emptyTokenUsage();
  }

  const input =
    finiteNumber(value.input) ||
    finiteNumber(value.input_tokens) ||
    finiteNumber(value.prompt_tokens) ||
    finiteNumber(value.prompt);
  const output =
    finiteNumber(value.output) ||
    finiteNumber(value.output_tokens) ||
    finiteNumber(value.completion_tokens) ||
    finiteNumber(value.completion);
  const reasoning =
    finiteNumber(value.reasoning) ||
    finiteNumber(value.reasoning_tokens);
  const cacheRead = isRecord(value.cache) ? finiteNumber(value.cache.read) : finiteNumber(value.cache_read_tokens);
  const cacheWrite = isRecord(value.cache) ? finiteNumber(value.cache.write) : finiteNumber(value.cache_write_tokens);
  const total =
    finiteNumber(value.total) ||
    finiteNumber(value.total_tokens) ||
    input + output + reasoning + cacheRead + cacheWrite;

  if (total <= 0) {
    return emptyTokenUsage();
  }

  const costFromUsage = finiteNumber(value.cost) || finiteNumber(value.estimated_cost);
  const costFromSource = isRecord(costSource)
    ? finiteNumber(costSource.cost) || finiteNumber(costSource.estimated_cost)
    : 0;
  const cost = costFromUsage || costFromSource;

  return {
    input_tokens: input,
    output_tokens: output + reasoning,
    total_tokens: total,
    estimated_cost: cost > 0 ? cost : null,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    events_count: 1,
  };
}

function parseReasonixToolCall(call: unknown, timestamp: string): ReasonixLiveEvent | null {
  if (!isRecord(call)) {
    return null;
  }

  const name = typeof call.name === "string" ? call.name : typeof call.tool === "string" ? call.tool : "tool";
  const summary = summarizeToolCall(name, call);
  return {
    timestamp,
    event_type: "reasonix_tool_call",
    kind: "tool",
    tool: sanitizeField(name, 48),
    status: "requested",
    summary,
  };
}

function summarizeToolCall(toolName: string, call: Record<string, unknown>): string {
  const parts: string[] = [`tool: ${sanitizeField(toolName, 48)}`];
  const args = summarizeToolArguments(call.arguments);
  if (args) {
    parts.push(`args: ${args}`);
  }

  if (typeof call.diff === "string" && call.diff.length > 0) {
    parts.push(`diff omitted (${call.diff.length} chars)`);
  }
  if (typeof call.added === "number") {
    parts.push(`added=${call.added}`);
  }
  if (typeof call.removed === "number") {
    parts.push(`removed=${call.removed}`);
  }

  return truncateSummary(sanitizeReasonixText(parts.join("\n")));
}

function summarizeToolArguments(argumentsValue: unknown): string {
  if (typeof argumentsValue === "string") {
    const parsed = tryParseJson(argumentsValue);
    if (parsed !== null) {
      return summarizeToolArgumentsObject(parsed);
    }
    return truncateInline(argumentsValue, 400);
  }
  if (isRecord(argumentsValue)) {
    return summarizeToolArgumentsObject(argumentsValue);
  }
  return "";
}

function summarizeToolArgumentsObject(value: unknown): string {
  if (!isRecord(value)) {
    return truncateInline(JSON.stringify(value) ?? String(value), 400);
  }

  const preferredKeys = [
    "command",
    "cmd",
    "filePath",
    "path",
    "pattern",
    "query",
    "description",
    "oldString",
    "newString",
  ];
  const parts: string[] = [];

  for (const key of preferredKeys) {
    if (!(key in value)) continue;
    const nested = value[key];
    if (typeof nested === "string") {
      if (key === "filePath" || key === "path") {
        parts.push(`${key}=${safeBasename(nested)}`);
      } else if (key === "oldString" || key === "newString") {
        parts.push(`${key}=${nested.length} chars`);
      } else {
        parts.push(`${key}=${truncateInline(nested, 260)}`);
      }
    } else if (nested !== undefined) {
      parts.push(`${key}=${truncateInline(JSON.stringify(nested) ?? String(nested), 260)}`);
    }
  }

  if (parts.length > 0) {
    return parts.join("; ");
  }

  return truncateInline(JSON.stringify(value) ?? String(value), 400);
}

function summarizeToolOutput(toolName: string | undefined, content: string): string {
  const normalized = (toolName ?? "").toLowerCase();
  if (isFileReadTool(normalized) && content.trim().length > 0) {
    return `file content omitted (${content.length} chars)`;
  }
  const limit = isShellTool(normalized) ? 1600 : 700;
  return truncateSummary(`output: ${truncateBlock(sanitizeReasonixText(content), limit)}`);
}

function isFileReadTool(toolName: string): boolean {
  return toolName === "read" || toolName === "read_file" || toolName === "file_read" || toolName === "view";
}

function isShellTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "shell" || toolName === "powershell" || toolName === "cmd";
}

function extractVisibleContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        if (isRecord(item) && typeof item.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function extractTimestamp(record: Record<string, unknown>, fallbackTimestampMs: number): string {
  const raw = record.timestamp ?? record.created_at ?? record.time;
  if (typeof raw === "number") {
    return new Date(raw).toISOString();
  }
  if (typeof raw === "string") {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date(fallbackTimestampMs).toISOString();
}

function boundEvents(
  events: ReasonixLiveEvent[],
  maxEvents: number,
  maxChars: number,
  alreadyTruncated: boolean,
): { events: ReasonixLiveEvent[]; truncated: boolean } {
  const recent = events.slice(-maxEvents);
  let charCount = 0;
  let charTruncated = false;
  const bounded: ReasonixLiveEvent[] = [];

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

function sanitizeReasonixText(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[A-Z]:\\[^\r\n"']*/gi, "[local path]")
    .replace(/\/(?:home|tmp|var|usr|opt)\/[^\s"']*/gi, "[local path]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.(?:jsonl|sqlite|db)\b/g, "[local file]")
    .replace(/\bses_[A-Za-z0-9_-]+\b/g, "[session]")
    .replace(/\bsession(?:_id|ID)?\b/gi, "[session]")
    .replace(/\bstdin\b/gi, "[stdin]")
    .replace(/\b(?:secret[_-]?)?token[_:-]?[A-Za-z0-9_.-]+\b/gi, "[redacted-token]")
    .replace(/\b(api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bpassword\b\s*[:=]\s*\S+/gi, "password=[redacted]")
    .trim();
}

function sanitizeEventType(type: string): string {
  return type.replace(/[^a-zA-Z0-9_.\-]/g, "_").slice(0, 64);
}

function sanitizeField(value: string, maxLen: number): string {
  return value.replace(/[^a-zA-Z0-9_.\-\/]/g, "_").slice(0, maxLen);
}

function safeBasename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const name = basename(normalized);
  return name || "[local path]";
}

function truncateSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  return summary.slice(0, MAX_SUMMARY_CHARS) + "\n[truncated]";
}

function truncateInline(value: string, maxLen: number): string {
  const compact = sanitizeReasonixText(value).replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen) + " [truncated]";
}

function truncateBlock(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "\n[truncated]";
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function emptyTokenUsage(): ReasonixTokenUsageSummary {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost: null,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    events_count: 0,
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
