import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import {
  getFocusedFiles,
  getBudgetedTaskSnapshot,
  getLimitedTaskDiff,
  readLogTail,
  refreshReviewPackage,
  validateTaskPaths,
  type FocusedFileResult,
} from "../services/review-package.js";

const DetailLevelSchema = z.enum(["summary", "review", "diff", "focused", "logs", "full"]);

export const GetTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  detail_level: DetailLevelSchema.default("review"),
  max_chars: z.number().int().min(1000).max(100000).default(8000),
  log_tail_lines: z.number().int().min(1).max(200).default(20),
  include_diff: z.boolean().default(false),
  include_logs: z.boolean().default(false),
  include_files: z.boolean().default(false),
  file_paths: z.array(z.string().min(1)).max(20).default([]),
  diff_paths: z.array(z.string().min(1)).max(20).default([]),
});

export type GetTaskInput = z.infer<typeof GetTaskSchema>;

export function createGetTaskHandler(taskStore: TaskStore) {
  return {
    schema: GetTaskSchema,
    handler: async (input: GetTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      const detailLevel = input.detail_level ?? "review";
      if (detailLevel === "summary") {
        return {
          task_id: task.task_id,
          detail_level: "summary",
          status: task.status,
          summary: task.summary.slice(0, 1000),
          completed: ["review", "accepted", "failed", "cancelled", "abandoned"].includes(task.status),
        };
      }

      if (detailLevel === "review") {
        const maxChars = input.max_chars ?? 8000;
        const includeCount = Number(Boolean(input.include_diff)) + Number(Boolean(input.include_logs)) + Number(Boolean(input.include_files));
        const reviewPackage = refreshReviewPackage(taskStore, task.task_id, {
          logTailLines: input.log_tail_lines ?? 20,
          maxChars: includeCount > 0 ? Math.max(1000, Math.floor(maxChars * 0.6)) : maxChars,
        });
        if (!reviewPackage) {
          return { error: `任务不存在: ${task.task_id}` };
        }

        let remaining = Math.max(0, maxChars - JSON.stringify(reviewPackage).length);
        let pendingIncludes = includeCount;
        let diff;
        let logs;
        let files;
        try {
          if (input.include_diff) {
            const diffPaths = validateTaskPaths(task, input.diff_paths ?? []);
            const budget = Math.max(1, Math.floor(remaining / Math.max(1, pendingIncludes)));
            const diffResult = getLimitedTaskDiff(task, diffPaths, budget);
            diff = {
              content: diffResult.text,
              total_chars: diffResult.totalChars,
              returned_chars: diffResult.returnedChars,
              truncated: diffResult.truncated,
            };
            remaining = Math.max(0, remaining - diffResult.returnedChars);
            pendingIncludes--;
          }
          if (input.include_logs) {
            const budget = Math.floor(remaining / Math.max(1, pendingIncludes));
            const perStreamBudget = Math.floor(budget / 2);
            logs = {
              stdout: readLogTail(task.raw_log_path, input.log_tail_lines ?? 20, perStreamBudget),
              stderr: readLogTail(task.stderr_log_path, input.log_tail_lines ?? 20, perStreamBudget),
            };
            remaining = Math.max(0, remaining - logs.stdout.length - logs.stderr.length);
            pendingIncludes--;
          }
          if (input.include_files) {
            if ((input.file_paths?.length ?? 0) === 0) {
              return { error: "include_files=true 时必须显式提供 file_paths" };
            }
            const budget = Math.floor(remaining / Math.max(1, pendingIncludes));
            files = getFocusedFiles(task, input.file_paths ?? [], budget);
          }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
        return {
          task_id: task.task_id,
          detail_level: "review",
          status: task.status,
          review_package: reviewPackage,
          ...(diff ? { diff: diff.content, diff_meta: diff } : {}),
          ...(logs ? { logs } : {}),
          ...(files ? { files } : {}),
        };
      }

      if (detailLevel === "diff") {
        try {
          const diffPaths = validateTaskPaths(task, input.diff_paths ?? []);
          const diff = getLimitedTaskDiff(task, diffPaths, input.max_chars ?? 8000);
          return {
            task_id: task.task_id,
            detail_level: "diff",
            diff: diff.text,
            total_chars: diff.totalChars,
            returned_chars: diff.returnedChars,
            truncated: diff.truncated,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }

      if (detailLevel === "logs") {
        const maxChars = input.max_chars ?? 8000;
        const perStreamBudget = Math.max(1, Math.floor(maxChars / 2));
        const logs = {
          stdout: readLogTail(task.raw_log_path, input.log_tail_lines ?? 20, perStreamBudget),
          stderr: readLogTail(task.stderr_log_path, input.log_tail_lines ?? 20, perStreamBudget),
        };
        return {
          task_id: task.task_id,
          detail_level: "logs",
          log_tail_lines: input.log_tail_lines ?? 20,
          logs,
          returned_chars: logs.stdout.length + logs.stderr.length,
        };
      }

      if (detailLevel === "focused") {
        const filePaths = input.file_paths ?? [];
        const diffPaths = input.diff_paths ?? [];
        if (filePaths.length === 0 && diffPaths.length === 0) {
          return { error: "focused 模式必须显式提供 file_paths 或 diff_paths" };
        }

        try {
          const maxChars = input.max_chars ?? 8000;
          const fileBudget = filePaths.length > 0 && diffPaths.length > 0 ? Math.floor(maxChars / 2) : maxChars;
          const files = getFocusedFiles(task, filePaths, fileBudget);
          let diff;
          if (diffPaths.length > 0) {
            const normalizedDiffPaths = validateTaskPaths(task, diffPaths);
            diff = getLimitedTaskDiff(task, normalizedDiffPaths, maxChars - files.reduce((sum, file) => sum + file.returned_chars, 0));
          }
          return {
            task_id: task.task_id,
            detail_level: "focused",
            files,
            ...(diff ? {
              diff: diff.text,
              diff_truncated: diff.truncated,
              diff_total_chars: diff.totalChars,
            } : {}),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }

      if (detailLevel === "full") {
        const maxChars = input.max_chars ?? 8000;
        if (maxChars < 4000) {
          return { error: "full 模式要求 max_chars 至少为 4000；请改用 review、diff、focused 或 logs" };
        }
        const reviewPackage = refreshReviewPackage(taskStore, task.task_id, {
          logTailLines: input.log_tail_lines ?? 20,
          maxChars: Math.floor(maxChars * 0.4),
        });
        const taskSnapshot = getBudgetedTaskSnapshot(task, Math.floor(maxChars * 0.4));
        const fixedChars = JSON.stringify(taskSnapshot).length + JSON.stringify(reviewPackage).length;
        let remaining = Math.max(0, maxChars - fixedChars);
        let diff = "";
        let diffTruncated = false;
        if (task.worktree && remaining > 0) {
          const diffPaths = validateTaskPaths(task, input.diff_paths ?? []);
          const diffResult = getLimitedTaskDiff(task, diffPaths, Math.max(1, Math.floor(remaining / 2)));
          diff = diffResult.text;
          diffTruncated = diffResult.truncated;
          remaining = Math.max(0, remaining - diff.length);
        }
        const perStreamBudget = Math.max(0, Math.floor(remaining / 2));
        const logs = {
          stdout: readLogTail(task.raw_log_path, input.log_tail_lines ?? 20, perStreamBudget),
          stderr: readLogTail(task.stderr_log_path, input.log_tail_lines ?? 20, perStreamBudget),
        };
        let files: FocusedFileResult[] = [];
        if (input.include_files && (input.file_paths?.length ?? 0) > 0) {
          const usedChars = fixedChars + diff.length + logs.stdout.length + logs.stderr.length;
          files = getFocusedFiles(task, input.file_paths ?? [], Math.max(0, maxChars - usedChars));
        }
        const returnedChars = fixedChars + diff.length + logs.stdout.length + logs.stderr.length +
          files.reduce((sum, file) => sum + file.returned_chars, 0);
        return {
          task_id: task.task_id,
          detail_level: "full",
          task: taskSnapshot,
          review_package: reviewPackage,
          diff,
          diff_truncated: diffTruncated,
          logs,
          files,
          returned_chars: returnedChars,
          max_chars: maxChars,
          truncated: returnedChars >= maxChars || diffTruncated || files.some((file) => file.truncated),
        };
      }

      return {
        error: `detail_level=${detailLevel} 尚未实现`,
      };
    },
  };
}
