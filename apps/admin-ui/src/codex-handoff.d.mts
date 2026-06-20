export const CODEX_NEW_THREAD_URL: "codex://threads/new";

export type CodexHandoffTask = {
  id: string;
  status?: string;
  title?: string;
  objective?: string;
};

export type CodexHandoffResult = {
  copied: boolean;
  prompt: string;
  url: typeof CODEX_NEW_THREAD_URL;
  error: string | null;
};

export function buildCodexReviewPrompt(task: CodexHandoffTask): string;

export function copyCodexReviewPrompt(
  task: CodexHandoffTask,
  writeText: (text: string) => Promise<void> | void,
): Promise<CodexHandoffResult>;
