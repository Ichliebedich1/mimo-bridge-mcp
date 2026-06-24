export const CODEX_NEW_THREAD_URL = "codex://threads/new";

const SAFE_THREAD_ID_RE = /^[a-zA-Z0-9_-]+$/;
const CODEX_THREAD_URL_RE = /^codex:\/\/threads\/([a-zA-Z0-9_-]+)$/;
const MAX_THREAD_ID_LENGTH = 128;

export function isSafeCodexThreadUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (url === CODEX_NEW_THREAD_URL) return true;
  const match = CODEX_THREAD_URL_RE.exec(url);
  return match !== null && match[1].length <= MAX_THREAD_ID_LENGTH;
}

export function buildCodexThreadUrl(threadId) {
  if (typeof threadId !== "string" || !threadId) return null;
  if (threadId.length > MAX_THREAD_ID_LENGTH) return null;
  if (!SAFE_THREAD_ID_RE.test(threadId)) return null;
  return "codex://threads/" + threadId;
}

export function resolveCodexHandoffUrl(originThreadId, originThreadUrl) {
  const directUrl = buildCodexThreadUrl(originThreadId);
  if (directUrl) return directUrl;
  if (typeof originThreadUrl === "string" && isSafeCodexThreadUrl(originThreadUrl)) {
    return originThreadUrl;
  }
  return CODEX_NEW_THREAD_URL;
}

export function buildCodexReviewPrompt(task) {
  const title = String(task.title || task.objective || task.id).trim();
  const objective = String(task.objective || task.title || "未提供目标").trim();
  const status = String(task.status || "unknown");

  return [
    `请接手并审查管理界面中的 MiMo 任务 ${task.id}。`,
    `任务：${title}`,
    `目标：${objective}`,
    `当前状态：${status}`,
    "",
    `请先调用 mimo_get_task(task_id="${task.id}", detail_level="review", max_chars=8000)。`,
    "先检查 editable_paths、changed_files、out_of_bounds_report、diff_stat、test_result 和 risk_flags。",
    "只有发现具体风险时，才按相关路径读取 focused diff、文件或日志尾部。",
    "请负责最终验收；复杂或高风险部分由 Codex 直接执行，不必全部退回 MiMo。",
    "",
    "注意：后续任务摘要、测试结果、遗留问题应使用中文书写；文件名、命令、代码标识保持原文。",
  ].join("\n");
}

export async function copyCodexReviewPrompt(task, writeText) {
  const prompt = buildCodexReviewPrompt(task);
  const url = resolveCodexHandoffUrl(task.originCodexThreadId, task.originCodexThreadUrl);
  try {
    await writeText(prompt);
    return { copied: true, prompt, url, error: null };
  } catch (error) {
    return {
      copied: false,
      prompt,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
