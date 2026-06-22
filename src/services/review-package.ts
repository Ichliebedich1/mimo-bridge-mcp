import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { validateEditablePaths } from "./path-guard.js";
import type { ChangedLinesSummary, ReviewPackage, ReviewRecommendation, TaskState } from "../types.js";
import type { TaskStore } from "./task-store.js";
import { GitWorktreeManager } from "./git-worktree.js";

const DEFAULT_LOG_TAIL_LINES = 20;
const DEFAULT_LOG_TAIL_CHARS = 1500;
const SUMMARY_CHARS = 1200;

export interface LimitedTextResult {
  text: string;
  totalChars: number;
  returnedChars: number;
  truncated: boolean;
}

export interface FocusedFileResult {
  path: string;
  content: string;
  total_chars: number;
  returned_chars: number;
  truncated: boolean;
}

export function getBudgetedTaskSnapshot(task: TaskState, maxChars: number) {
  const snapshot = {
    task_id: task.task_id,
    status: task.status,
    agent: task.agent,
    session_id: task.session_id,
    config: {
      ...task.config,
      editable_paths: [...task.config.editable_paths],
      readonly_paths: [...task.config.readonly_paths],
      acceptance_criteria: [...task.config.acceptance_criteria],
    },
    current_round: task.current_round,
    created_at: task.created_at,
    updated_at: task.updated_at,
    summary: task.summary,
    modified_files: [...task.modified_files],
    test_results: task.test_results,
    questions: [...task.questions],
    issues: [...task.issues],
    raw_log_path: task.raw_log_path,
    stderr_log_path: task.stderr_log_path,
    error: task.error,
    exit_code: task.exit_code ?? null,
    worktree: task.worktree,
  };
  const size = () => JSON.stringify(snapshot).length;

  while (size() > maxChars && snapshot.questions.length > 0) snapshot.questions.pop();
  while (size() > maxChars && snapshot.issues.length > 0) snapshot.issues.pop();
  while (size() > maxChars && snapshot.modified_files.length > 0) snapshot.modified_files.pop();
  while (size() > maxChars && snapshot.config.acceptance_criteria.length > 0) snapshot.config.acceptance_criteria.pop();
  while (size() > maxChars && snapshot.config.readonly_paths.length > 0) snapshot.config.readonly_paths.pop();
  while (size() > maxChars && snapshot.config.editable_paths.length > 0) snapshot.config.editable_paths.pop();
  while (size() > maxChars && snapshot.summary.length > 80) snapshot.summary = snapshot.summary.slice(0, Math.floor(snapshot.summary.length / 2));
  while (size() > maxChars && snapshot.test_results.length > 80) snapshot.test_results = snapshot.test_results.slice(0, Math.floor(snapshot.test_results.length / 2));
  while (size() > maxChars && snapshot.config.objective.length > 80) snapshot.config.objective = snapshot.config.objective.slice(0, Math.floor(snapshot.config.objective.length / 2));

  return snapshot;
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  if (maxChars <= 0) {
    return { text: "", truncated: value.length > 0 };
  }
  const suffix = "\n...[truncated]";
  if (maxChars <= suffix.length) {
    return { text: value.slice(0, maxChars), truncated: true };
  }
  return {
    text: value.slice(0, maxChars - suffix.length) + suffix,
    truncated: true,
  };
}

export function getLimitedTaskDiff(task: TaskState, paths: string[], maxChars: number): LimitedTextResult {
  if (!task.worktree) {
    throw new Error("任务没有 Worktree，无法生成可靠 Git diff");
  }

  const args = ["diff", "--no-color", task.worktree.base_commit];
  if (paths.length > 0) {
    args.push("--", ...paths);
  }
  const maxBuffer = Math.max(64 * 1024, maxChars * 4);
  const result = spawnSync("git", args, {
    cwd: task.worktree.worktree_path,
    encoding: "utf-8",
    maxBuffer,
  });
  const output = result.stdout ?? "";
  if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOBUFS") {
    throw new Error(`生成 Git diff 失败: ${result.error.message}`);
  }
  if (result.status !== 0 && !result.error) {
    throw new Error(`生成 Git diff 失败: ${result.stderr || `exit ${result.status}`}`);
  }
  const limited = truncateText(output, maxChars);
  const overflowed = Boolean(result.error) || limited.truncated;
  const totalChars = result.error ? Math.max(output.length, maxChars + 1) : output.length;
  return {
    text: limited.text,
    totalChars,
    returnedChars: limited.text.length,
    truncated: overflowed,
  };
}

function getTaskContentRoot(task: TaskState): string {
  return task.worktree?.worktree_path ?? task.config.workspace_path;
}

export function validateTaskPaths(task: TaskState, paths: string[]): string[] {
  const root = getTaskContentRoot(task);
  const validation = validateEditablePaths(paths, root);
  if (!validation.allowed) {
    throw new Error(validation.reason ?? "请求路径超出任务工作区");
  }

  const realRoot = realpathSync(root);
  return paths.map((requestedPath) => {
    const absolutePath = resolve(root, requestedPath);
    const rel = relative(realRoot, absolutePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`请求路径超出任务工作区: ${requestedPath}`);
    }
    return rel.replace(/\\/g, "/");
  });
}

export function getFocusedFiles(task: TaskState, paths: string[], maxChars: number): FocusedFileResult[] {
  const root = getTaskContentRoot(task);
  const normalizedPaths = validateTaskPaths(task, paths);
  const results: FocusedFileResult[] = [];
  let remaining = maxChars;

  for (const normalizedPath of normalizedPaths) {
    if (remaining <= 0) break;
    const filePath = resolve(root, normalizedPath);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new Error(`请求文件不存在或不是普通文件: ${normalizedPath}`);
    }
    const realFilePath = realpathSync(filePath);
    const rel = relative(realpathSync(root), realFilePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`请求文件通过链接指向工作区外: ${normalizedPath}`);
    }

    const fd = openSync(realFilePath, "r");
    try {
      const totalChars = fstatSync(fd).size;
      const bytesToRead = Math.min(totalChars, remaining + 1);
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
      const decoded = buffer.subarray(0, bytesRead).toString("utf-8");
      const limited = truncateText(decoded, remaining);
      results.push({
        path: normalizedPath,
        content: limited.text,
        total_chars: totalChars,
        returned_chars: limited.text.length,
        truncated: totalChars > remaining || limited.truncated,
      });
      remaining -= limited.text.length;
    } finally {
      closeSync(fd);
    }
  }

  return results;
}

export function readLogTail(filePath: string, maxLines: number, maxChars: number): string {
  if (!filePath || !existsSync(filePath) || maxLines <= 0 || maxChars <= 0) {
    return "";
  }

  const fd = openSync(filePath, "r");
  try {
    const size = fstatSync(fd).size;
    const chunkSize = 4096;
    let position = size;
    let content = "";

    while (position > 0 && content.split(/\r?\n/).length <= maxLines + 1 && content.length < maxChars * 4) {
      const bytesToRead = Math.min(chunkSize, position);
      position -= bytesToRead;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      readSync(fd, buffer, 0, bytesToRead, position);
      content = buffer.toString("utf-8") + content;
    }

    const lines = content.split(/\r?\n/).filter((line) => line.length > 0).slice(-maxLines);
    return truncateText(lines.join("\n"), maxChars).text;
  } finally {
    closeSync(fd);
  }
}

function extractTestCommands(testResults: string): string[] {
  const commandPattern = /^(?:\$\s*)?(?:npm(?:\.cmd)?|node|npx|pnpm|yarn|pytest|cargo|go test|dotnet test)\b.+$/i;
  return [...new Set(testResults.split(/\r?\n/).map((line) => line.trim()).filter((line) => commandPattern.test(line)))].slice(0, 20);
}

function classifyTestResult(testResults: string): string {
  const normalized = testResults.trim();
  if (!normalized) return "not_reported";
  if (/\b(?:failed|failure|error)\b|失败/i.test(normalized) && !/\b0\s+(?:failed|failures)\b/i.test(normalized)) {
    return "failed";
  }
  if (/\b(?:passed|pass|success|successful)\b|通过/i.test(normalized)) {
    return "passed";
  }
  return "reported";
}

function getRecommendation(task: TaskState, riskFlags: string[]): ReviewRecommendation {
  if (task.status === "queued" || task.status === "running" || task.status === "waiting") return "wait";
  if (riskFlags.includes("OUT_OF_BOUNDS_CHANGES") || riskFlags.includes("TASK_FAILED") || riskFlags.includes("NON_ZERO_EXIT")) {
    return "reject";
  }
  if (riskFlags.length > 0) return "needs_attention";
  return "approve";
}

function fitReviewPackageToBudget(reviewPackage: ReviewPackage, maxChars: number): ReviewPackage {
  const result: ReviewPackage = {
    ...reviewPackage,
    editable_paths: [...reviewPackage.editable_paths],
    changed_files: [...reviewPackage.changed_files],
    changed_lines_summary: reviewPackage.changed_lines_summary.map((entry) => ({ ...entry })),
    out_of_bounds_report: {
      ...reviewPackage.out_of_bounds_report,
      files: [...reviewPackage.out_of_bounds_report.files],
    },
    test_commands: [...reviewPackage.test_commands],
    risk_flags: [...reviewPackage.risk_flags],
  };
  const size = () => JSON.stringify(result).length;
  if (size() <= maxChars) return result;
  result.truncated = true;

  result.log_tail = "";
  while (size() > maxChars && result.changed_lines_summary.length > 0) result.changed_lines_summary.pop();
  while (size() > maxChars && result.changed_files.length > 0) result.changed_files.pop();
  while (size() > maxChars && result.editable_paths.length > 0) result.editable_paths.pop();
  while (size() > maxChars && result.test_commands.length > 0) result.test_commands.pop();
  while (size() > maxChars && result.out_of_bounds_report.files.length > 0) result.out_of_bounds_report.files.pop();

  const stringFields: Array<keyof Pick<ReviewPackage, "mimo_summary" | "diff_stat" | "objective">> = [
    "mimo_summary",
    "diff_stat",
    "objective",
  ];
  for (const field of stringFields) {
    while (size() > maxChars && result[field].length > 40) {
      result[field] = result[field].slice(0, Math.max(40, Math.floor(result[field].length / 2)));
    }
  }

  if (result.objective_zh) {
    while (size() > maxChars && result.objective_zh.length > 40) {
      result.objective_zh = result.objective_zh.slice(0, Math.max(40, Math.floor(result.objective_zh.length / 2)));
    }
    if (size() > maxChars) delete result.objective_zh;
  }
  if (result.mimo_summary_zh) {
    while (size() > maxChars && result.mimo_summary_zh.length > 40) {
      result.mimo_summary_zh = result.mimo_summary_zh.slice(0, Math.max(40, Math.floor(result.mimo_summary_zh.length / 2)));
    }
    if (size() > maxChars) delete result.mimo_summary_zh;
  }

  return result;
}

export function generateReviewPackage(
  task: TaskState,
  options: { logTailLines?: number; maxChars?: number } = {}
): ReviewPackage {
  const maxChars = options.maxChars ?? 8000;
  const summary = truncateText(task.summary || "", Math.min(SUMMARY_CHARS, maxChars));
  const rawTail = readLogTail(task.raw_log_path, options.logTailLines ?? DEFAULT_LOG_TAIL_LINES, DEFAULT_LOG_TAIL_CHARS);
  const stderrTail = readLogTail(task.stderr_log_path, options.logTailLines ?? DEFAULT_LOG_TAIL_LINES, DEFAULT_LOG_TAIL_CHARS);
  const combinedTail = [rawTail && `[stdout]\n${rawTail}`, stderrTail && `[stderr]\n${stderrTail}`].filter(Boolean).join("\n");
  const logTail = truncateText(combinedTail, DEFAULT_LOG_TAIL_CHARS);
  let allChangedFiles = [...new Set(task.modified_files)];
  let changedFiles = allChangedFiles.slice(0, 200);
  let outOfBoundsFiles = [...new Set(task.worktree?.out_of_bounds_files ?? [])].slice(0, 200);
  let hasOutOfBoundsChanges = outOfBoundsFiles.length > 0 || Boolean(task.worktree?.has_out_of_bounds_changes);
  let diffStat = task.worktree?.diff_summary ?? "";
  let changedLinesSummary: ChangedLinesSummary[] = [];
  let reviewDataError = false;

  if (task.worktree) {
    try {
      const manager = GitWorktreeManager.fromWorktreeState(task.worktree);
      const diffSummary = manager.getDiffSummaryForState(task.task_id, task.worktree, task.config.editable_paths);
      allChangedFiles = [...new Set([
        ...diffSummary.modifiedFiles,
        ...diffSummary.addedFiles,
        ...diffSummary.deletedFiles,
      ])];
      changedFiles = allChangedFiles.slice(0, 200);
      outOfBoundsFiles = diffSummary.outOfBoundsFiles.slice(0, 200);
      hasOutOfBoundsChanges = diffSummary.hasOutOfBoundsChanges;
      diffStat = diffSummary.diffStat;
      changedLinesSummary = manager.getChangedLinesSummary(task.task_id, task.worktree.base_commit).slice(0, 200);
      const summarizedPaths = new Set(changedLinesSummary.map((entry) => entry.path));
      for (const file of changedFiles) {
        if (!summarizedPaths.has(file)) {
          changedLinesSummary.push({ path: file, additions: null, deletions: null });
        }
      }
    } catch {
      reviewDataError = true;
    }
  }
  const testResult = classifyTestResult(task.test_results);
  const riskFlags: string[] = [];

  if (hasOutOfBoundsChanges) riskFlags.push("OUT_OF_BOUNDS_CHANGES");
  if (testResult === "failed") riskFlags.push("TESTS_FAILED");
  if (task.status === "failed") riskFlags.push("TASK_FAILED");
  if (task.exit_code !== null && task.exit_code !== undefined && task.exit_code !== 0) riskFlags.push("NON_ZERO_EXIT");
  if (task.error) riskFlags.push("TASK_ERROR");
  if (task.issues.length > 0) riskFlags.push("ISSUES_REPORTED");
  if (reviewDataError) riskFlags.push("REVIEW_DATA_UNAVAILABLE");
  if (
    task.status === "review" &&
    task.config.editable_paths.length > 0 &&
    allChangedFiles.length === 0 &&
    testResult === "not_reported"
  ) {
    riskFlags.push("NO_CHANGES_AND_NO_TESTS");
  }

  const objectiveText = truncateText(task.config.objective, 500).text;
  const summaryText = summary.text;
  const hasChinese = /[\u4e00-\u9fff]/.test(objectiveText);
  const summaryHasChinese = /[\u4e00-\u9fff]/.test(summaryText);

  const reviewPackage: ReviewPackage = {
    task_id: task.task_id,
    status: task.status,
    objective: objectiveText,
    ...(hasChinese ? { objective_zh: objectiveText } : {}),
    editable_paths: task.config.editable_paths.slice(0, 50),
    changed_files: changedFiles,
    changed_files_count: allChangedFiles.length,
    diff_stat: truncateText(diffStat, 1200).text,
    changed_lines_summary: changedLinesSummary,
    out_of_bounds_report: {
      has_changes: hasOutOfBoundsChanges,
      files: outOfBoundsFiles,
    },
    test_commands: extractTestCommands(task.test_results),
    test_result: testResult,
    exit_code: task.exit_code ?? null,
    log_tail: logTail.text,
    mimo_summary: summaryText,
    ...(summaryHasChinese ? { mimo_summary_zh: summaryText } : {}),
    risk_flags: [...new Set(riskFlags)],
    generated_at: new Date().toISOString(),
    review_recommendation: getRecommendation(task, riskFlags),
    truncated: summary.truncated || logTail.truncated || allChangedFiles.length > changedFiles.length,
  };
  return fitReviewPackageToBudget(reviewPackage, maxChars);
}

export function refreshReviewPackage(
  taskStore: TaskStore,
  taskId: string,
  options: { logTailLines?: number; maxChars?: number } = {}
): ReviewPackage | null {
  const task = taskStore.getTask(taskId);
  if (!task) return null;
  const reviewPackage = generateReviewPackage(task, options);
  taskStore.updateReviewPackage(taskId, reviewPackage);
  return reviewPackage;
}
