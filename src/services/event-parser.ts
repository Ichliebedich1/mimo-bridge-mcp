import type { MimoEvent } from "../types.js";

export interface ParsedResult {
  sessionId: string | null;
  textChunks: string[];
  events: MimoEvent[];
  rawLines: string[];
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

  function processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    rawLines.push(trimmed);

    try {
      const event = JSON.parse(trimmed) as MimoEvent;
      events.push(event);

      if (event.sessionID) {
        sessionId = event.sessionID;
      }
      if (event.part?.sessionID) {
        sessionId = event.part.sessionID;
      }
      if (event.type === "text" && event.part?.text) {
        textChunks.push(event.part.text);
      }
    } catch {
      // 保留无效 JSON 行作为原始日志
    }
  }

  function parse(data: string): ParsedResult {
    buffer += data;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }

    return { sessionId, textChunks: [...textChunks], events: [...events], rawLines: [...rawLines] };
  }

  function flush(): ParsedResult {
    if (buffer.trim()) {
      processLine(buffer);
      buffer = "";
    }

    return { sessionId, textChunks: [...textChunks], events: [...events], rawLines: [...rawLines] };
  }

  function getSummary(result: ParsedResult): string {
    return result.textChunks.join("").trim();
  }

  function extractQuestions(result: ParsedResult): string[] {
    const summary = getSummary(result);
    const questions: string[] = [];

    const questionPatterns = [
      /请问[^。？\n]+[？?]/g,
      /是否[^。？\n]+[？?]/g,
      /需要确认[^。？\n]+[？?]/g,
      /能否[^。？\n]+[？?]/g,
      /是否需要[^。？\n]+[？?]/g,
    ];

    for (const pattern of questionPatterns) {
      const matches = summary.match(pattern);
      if (matches) {
        questions.push(...matches);
      }
    }

    return [...new Set(questions)];
  }

  function extractIssues(result: ParsedResult): string[] {
    const summary = getSummary(result);
    const issues: string[] = [];

    const issuePatterns = [
      /问题[：:][^。\n]+/g,
      /错误[：:][^。\n]+/g,
      /失败[：:][^。\n]+/g,
      /警告[：:][^。\n]+/g,
      /遗留[^。\n]+/g,
    ];

    for (const pattern of issuePatterns) {
      const matches = summary.match(pattern);
      if (matches) {
        issues.push(...matches);
      }
    }

    return [...new Set(issues)];
  }

  return { parse, flush, getSummary, extractQuestions, extractIssues };
}
