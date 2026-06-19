import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { GitWorktreeManager } from "../services/git-worktree.js";

export const MergeTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  action: z.enum(["merge", "discard"]),
});

export type MergeTaskInput = z.infer<typeof MergeTaskSchema>;

export function createMergeTaskHandler(taskStore: TaskStore) {
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

      const originalWorkspacePath = task.config.workspace_path;
      const gitManager = new GitWorktreeManager(originalWorkspacePath);

      if (!gitManager.isGitRepo()) {
        return { error: `路径不是 Git 仓库: ${originalWorkspacePath}` };
      }

      const worktreePath = task.worktree.worktree_path;
      const expectedWorktreePath = `${originalWorkspacePath}\\.worktrees\\${input.task_id}`.replace(/\//g, "\\");
      const expectedWorktreePathUnix = `${originalWorkspacePath}/.worktrees/${input.task_id}`.replace(/\\/g, "/");

      if (!worktreePath.replace(/\\/g, "/").includes(".worktrees")) {
        return { error: "Worktree 路径异常，安全检查失败" };
      }

      try {
        if (input.action === "merge") {
          const summary = gitManager.getDiffSummary(
            input.task_id,
            task.config.editable_paths,
            originalWorkspacePath
          );

          if (summary.hasOutOfBoundsChanges) {
            return {
              error: "存在超出 editable_paths 的修改，请先审核",
              out_of_bounds_files: summary.outOfBoundsFiles,
            };
          }

          const targetBranch = task.worktree.branch_name.replace("task/", "").startsWith("task/")
            ? gitManager.getCurrentBranch()
            : "master";

          const currentBranch = gitManager.getCurrentBranch();

          gitManager.mergeWorktree(input.task_id, currentBranch);
          gitManager.removeWorktree(input.task_id);
          taskStore.clearTaskWorktree(input.task_id);

          return {
            task_id: input.task_id,
            action: "merge",
            status: "merged",
            target_branch: currentBranch,
          };
        } else {
          gitManager.discardWorktree(input.task_id);
          taskStore.clearTaskWorktree(input.task_id);

          return {
            task_id: input.task_id,
            action: "discard",
            status: "discarded",
          };
        }
      } catch (err) {
        return { error: `操作失败: ${err}` };
      }
    },
  };
}
