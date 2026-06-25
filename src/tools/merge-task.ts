import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import { GitWorktreeManager } from "../services/git-worktree.js";
import { isAbsolute, relative, resolve } from "node:path";

export const MergeTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  action: z.enum(["merge", "discard"]),
});

export type MergeTaskInput = z.infer<typeof MergeTaskSchema>;

export function createMergeTaskHandler(taskStore: TaskStore, config: Pick<Config, "runtimeDir">) {
  return {
    schema: MergeTaskSchema,
    handler: async (input: MergeTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (!task.worktree) {
        return { error: "任务没有关联的 Worktree" };
      }

      const mergeAllowed = task.status === "review" || task.status === "accepted";
      const discardAllowed = mergeAllowed || task.status === "failed" || task.status === "cancelled" || task.status === "abandoned";
      if (input.action === "merge" && !mergeAllowed) {
        return { error: `任务状态不允许合并: ${task.status}` };
      }
      if (input.action === "discard" && !discardAllowed) {
        return { error: `任务状态不允许丢弃 Worktree: ${task.status}` };
      }

      try {
        const worktreeState = task.worktree;
        const gitManager = new GitWorktreeManager(worktreeState.repo_path, config.runtimeDir);

        if (input.action === "merge") {
          gitManager.assertWorktreeState(input.task_id, worktreeState);
          const summary = gitManager.getDiffSummaryForState(
            input.task_id,
            worktreeState,
            task.config.editable_paths
          );

          if (summary.hasOutOfBoundsChanges) {
            return {
              error: "存在超出 editable_paths 的修改，请先审核",
              out_of_bounds_files: summary.outOfBoundsFiles,
            };
          }

          if (!gitManager.isRepoClean()) {
            return { error: "原仓库工作区存在未提交修改，不能自动合并" };
          }

          gitManager.mergeWorktree(
            input.task_id,
            worktreeState.base_branch,
            worktreeState.branch_name
          );
          gitManager.removeWorktree(input.task_id);
          gitManager.deleteBranch(worktreeState.branch_name);
          taskStore.clearTaskWorktree(input.task_id);

          return {
            task_id: input.task_id,
            action: "merge",
            status: "merged",
            target_branch: worktreeState.base_branch,
          };
        } else {
          const safetyError = validateDiscardTarget(input.task_id, worktreeState.worktrees_root, worktreeState.worktree_path);
          if (safetyError) {
            return { error: safetyError };
          }
          gitManager.discardWorktree(input.task_id, worktreeState.branch_name);
          taskStore.clearTaskWorktree(input.task_id);

          return {
            task_id: input.task_id,
            action: "discard",
            status: "discarded",
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: `操作失败: ${message}` };
      }
    },
  };
}

function validateDiscardTarget(taskId: string, worktreesRoot: string, worktreePath: string): string | null {
  const root = resolve(worktreesRoot);
  const target = resolve(worktreePath);
  const expected = resolve(root, taskId);
  const rel = relative(root, target);

  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return "Worktree 路径不在保存的根目录内，拒绝清理";
  }
  if (!samePath(target, expected)) {
    return "Worktree 路径与任务 ID 不匹配，拒绝清理";
  }
  return null;
}

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
