export const CODEX_NEW_THREAD_URL: "codex://threads/new";

export type CodexHandoffTask = {
  id: string;
  status?: string;
  title?: string;
  objective?: string;
  originCodexThreadId?: string | null;
  originCodexThreadUrl?: string | null;
};

export type CodexHandoffResult = {
  copied: boolean;
  prompt: string;
  url: string;
  error: string | null;
};

export function isSafeCodexThreadUrl(url: unknown): boolean;

export function buildCodexThreadUrl(threadId: string): string | null;

export function resolveCodexHandoffUrl(
  originThreadId?: string | null,
  originThreadUrl?: string | null,
): string;

export function buildCodexReviewPrompt(task: CodexHandoffTask): string;

export function copyCodexReviewPrompt(
  task: CodexHandoffTask,
  writeText: (text: string) => Promise<void> | void,
): Promise<CodexHandoffResult>;
