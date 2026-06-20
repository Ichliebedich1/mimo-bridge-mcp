export const CODEX_NEW_THREAD_URL = "codex://threads/new";

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
  ].join("\n");
}

export async function copyCodexReviewPrompt(task, writeText) {
  const prompt = buildCodexReviewPrompt(task);
  try {
    await writeText(prompt);
    return { copied: true, prompt, url: CODEX_NEW_THREAD_URL, error: null };
  } catch (error) {
    return {
      copied: false,
      prompt,
      url: CODEX_NEW_THREAD_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
