import type { MimoEvent } from "../types.js";

export interface ParsedResult {
  sessionId: string | null;
  textChunks: string[];
  events: MimoEvent[];
  rawLines: string[];
}

function findJsonObjectEnd(input: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return null;
}

export function createEventParser(): {
  parse: (data: string) => ParsedResult;
  flush: () => ParsedResult;
  getSummary: (result: ParsedResult) => string;
  extractQuestions: (result: ParsedResult) => string[];
  extractIssues: (result: ParsedResult) => string[];
} {
  let buffer = "";
  const events: MimoEvent[] = [];
  const textChunks: string[] = [];
  const rawLines: string[] = [];
  let sessionId: string | null = null;

  function processJson(jsonStr: string): void {
    rawLines.push(jsonStr);

    try {
      const event = parseEventJson(jsonStr);
      events.push(event);

      if (event.sessionID) {
        sessionId = event.sessionID;
      }
      if (event.part?.sessionID) {
        sessionId = event.part.sessionID;
      }
      if (event.part?.type === "text" && event.part.text) {
        textChunks.push(event.part.text);
      }
    } catch {
      // Keep the raw line for diagnostics, but continue parsing later objects.
    }
  }

  function parseEventJson(jsonStr: string): MimoEvent {
    try {
      return JSON.parse(jsonStr) as MimoEvent;
    } catch (err) {
      const withoutPtyWraps = jsonStr.replace(/[\r\n]+/g, "");
      if (withoutPtyWraps !== jsonStr) {
        return JSON.parse(withoutPtyWraps) as MimoEvent;
      }
      throw err;
    }
  }

  function recordDiscarded(raw: string): void {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        rawLines.push(trimmed);
      }
    }
  }

  function drainBuffer(final = false): void {
    while (buffer.length > 0) {
      const start = buffer.indexOf("{");

      if (start === -1) {
        if (final) {
          recordDiscarded(buffer);
          buffer = "";
          return;
        }

        const lastNewline = Math.max(buffer.lastIndexOf("\n"), buffer.lastIndexOf("\r"));
        if (lastNewline >= 0) {
          recordDiscarded(buffer.slice(0, lastNewline + 1));
          buffer = buffer.slice(lastNewline + 1);
        }
        return;
      }

      if (start > 0) {
        recordDiscarded(buffer.slice(0, start));
        buffer = buffer.slice(start);
      }

      const end = findJsonObjectEnd(buffer, 0);
      if (end === null) {
        return;
      }

      processJson(buffer.slice(0, end + 1));
      buffer = buffer.slice(end + 1);
    }
  }

  function parse(data: string): ParsedResult {
    buffer += data;
    drainBuffer();

    return { sessionId, textChunks: [...textChunks], events: [...events], rawLines: [...rawLines] };
  }

  function flush(): ParsedResult {
    drainBuffer(true);

    return { sessionId, textChunks: [...textChunks], events: [...events], rawLines: [...rawLines] };
  }

  function getSummary(result: ParsedResult): string {
    return result.textChunks.join("").trim();
  }

  function extractQuestions(result: ParsedResult): string[] {
    const summary = getSummary(result);
    const questions = summary.match(/[^。！？!?\n]+[？?]/g) || [];
    return [...new Set(questions.map((question) => question.trim()))];
  }

  function extractIssues(result: ParsedResult): string[] {
    const summary = getSummary(result);
    const issuePatterns = [
      /问题[:：]?[^。！？\n]*/g,
      /错误[:：]?[^。！？\n]*/g,
      /失败[:：]?[^。！？\n]*/g,
      /警告[:：]?[^。！？\n]*/g,
      /遗留[^。！？\n]*/g,
      /error[:：]?[^。！？\n]*/gi,
      /failed[:：]?[^。！？\n]*/gi,
      /warning[:：]?[^。！？\n]*/gi,
    ];
    const issues: string[] = [];

    for (const pattern of issuePatterns) {
      const matches = summary.match(pattern);
      if (matches) {
        issues.push(...matches.map((issue) => issue.trim()));
      }
    }

    return [...new Set(issues)];
  }

  return { parse, flush, getSummary, extractQuestions, extractIssues };
}
