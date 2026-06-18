import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";
import { validateWorkspacePath, validateEditablePaths, validateMaxRounds, validateTimeout } from "../services/path-guard.js";
import { writeTaskBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks } from "../services/running-tasks.js";
import { GitWorktreeManager } from "../services/git-worktree.js";

export const StartTaskSchema = z.object({
  objective: z.string().min(1, "任务目标不能为空"),
  workspace_path: z.string().min(1, "工作区路径不能为空"),
  editable_paths: z.array(z.string()).default([]),
  readonly_paths: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  max_rounds: z.number().int().min(1).max(10).default(5),
  runtime_timeout_seconds: z.number().int().min(60).max(3600).default(900),
  use_worktree: z.boolean().default(true),
});

export type StartTaskInput = z.infer<typeof StartTaskSchema>;

export function createStartTaskHandler(config: Config, taskStore: TaskStore) {
  return {
    schema: StartTaskSchema,
    handler: async (input: StartTaskInput) => {
      if (globalRunningTasks.hasAny()) {
        return { error: "已有任务在运行中，第一版只支持同时运行一个写任务" };
      }

      const workspaceValidation = validateWorkspacePath(input.workspace_path, config.allowedRoots);
      if (!workspaceValidation.allowed) {
        return { error: workspaceValidation.reason };
      }

      const editableValidation = validateEditablePaths(input.editable_paths, input.workspace_path);
      if (!editableValidation.allowed) {
        return { error: editableValidation.reason };
      }

      const maxRoundsValidation = validateMaxRounds(input.max_rounds);
      if (!maxRoundsValidation.allowed) {
        return { error: maxRoundsValidation.reason };
      }

      const timeoutValidation = validateTimeout(input.runtime_timeout_seconds);
      if (!timeoutValidation.allowed) {
        return { error: timeoutValidation.reason };
      }

      const task = taskStore.createTask({
        objective: input.objective,
        workspace_path: input.workspace_path,
        editable_paths: input.editable_paths,
        readonly_paths: input.readonly_paths,
        acceptance_criteria: input.acceptance_criteria,
        max_rounds: input.max_rounds,
        runtime_timeout_seconds: input.runtime_timeout_seconds,
      });

      let worktreePath = input.workspace_path;
      const gitManager = new GitWorktreeManager(input.workspace_path);

      if (input.use_worktree && gitManager.isGitRepo()) {
        try {
          const worktreeInfo = gitManager.createWorktree(task.task_id);
          worktreePath = worktreeInfo.worktreePath;

          taskStore.updateTaskWorktree(task.task_id, {
            worktree_path: worktreeInfo.worktreePath,
            branch_name: worktreeInfo.branchName,
            base_commit: worktreeInfo.baseCommit,
            diff_summary: null,
            out_of_bounds_files: [],
            has_out_of_bounds_changes: false,
          });
        } catch (err) {
          process.stderr.write(`[start-task] 创建 Worktree 失败，使用原始工作区: ${err}\n`);
        }
      }

      const taskConfig = { ...task.config, workspace_path: worktreePath };
      writeTaskBrief(taskConfig, task.task_id, task.current_round, `${config.runtimeDir}/briefs`);

      taskStore.updateTaskStatus(task.task_id, "running");

      const handle = runMimoTask(
        {
          mimoNodePath: config.mimoNodePath,
          mimoEntryPath: config.mimoEntryPath,
          task: { ...task, config: taskConfig },
          runtimeDir: config.runtimeDir,
          timeoutMs: input.runtime_timeout_seconds * 1000,
        },
        (result: TaskResult) => {
          if (result.session_id) {
            taskStore.updateTaskSession(task.task_id, result.session_id);
          }
          taskStore.updateTaskResult(task.task_id, result);
          taskStore.updateTaskStatus(task.task_id, result.status);
          globalRunningTasks.unregister(task.task_id);

          if (task.worktree) {
            try {
              const summary = gitManager.getDiffSummary(task.task_id, input.editable_paths);
              taskStore.updateTaskWorktree(task.task_id, {
                ...task.worktree,
                diff_summary: summary.diffStat,
                out_of_bounds_files: summary.outOfBoundsFiles,
                has_out_of_bounds_changes: summary.hasOutOfBoundsChanges,
              });
            } catch (err) {
              process.stderr.write(`[start-task] 获取 diff 摘要失败: ${err}\n`);
            }
          }
        },
        (error: string) => {
          taskStore.updateTaskStatus(task.task_id, "failed", error);
          globalRunningTasks.unregister(task.task_id);
        }
      );

      globalRunningTasks.register(task.task_id, handle.cancel);

      return {
        task_id: task.task_id,
        status: "running",
        worktree_path: worktreePath,
      };
    },
    cancelTask: (taskId: string) => {
      return globalRunningTasks.cancel(taskId);
    },
  };
}
