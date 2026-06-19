import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import { GitWorktreeManager } from "../services/git-worktree.js";

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

      if (task.status !== "review" && task.status !== "accepted") {
        return { error: `任务状态不允许合并: ${task.status}` };
      }

      try {
        const worktreeState = task.worktree;
        const gitManager = new GitWorktreeManager(worktreeState.repo_path, config.runtimeDir);
        gitManager.assertWorktreeState(input.task_id, worktreeState);

        if (input.action === "merge") {
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
