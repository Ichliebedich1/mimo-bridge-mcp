import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";
import { validateSessionId } from "../services/path-guard.js";
import { writeReplyBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";
import { refreshReviewPackage } from "../services/review-package.js";
import { GitWorktreeManager } from "../services/git-worktree.js";

export interface ReplyTaskDependencies {
  runTask?: typeof runMimoTask;
  runningTasks?: RunningTaskRegistry;
  taskQueue?: TaskQueue;
}

export const ReplyTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  message: z.string().min(1, "回复消息不能为空"),
  priority: z.number().int().min(0).max(10).default(5),
});

export type ReplyTaskInput = z.infer<typeof ReplyTaskSchema>;

export function createReplyTaskHandler(
  config: Config,
  taskStore: TaskStore,
  dependencies: ReplyTaskDependencies = {}
) {
  const runTask = dependencies.runTask ?? runMimoTask;
  const runningTasks = dependencies.runningTasks ?? globalRunningTasks;
  const taskQueue = dependencies.taskQueue ?? globalTaskQueue;

  function executeReply(taskId: string): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) return Promise.resolve();

    let worktreeState = task.worktree;
    let taskConfig = task.config;
    try {
      if (worktreeState) {
        const gitManager = GitWorktreeManager.fromWorktreeState(worktreeState);
        gitManager.assertWorktreeState(taskId, worktreeState);
        taskConfig = { ...task.config, workspace_path: worktreeState.worktree_path };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      taskStore.updateTaskStatus(taskId, "failed", error);
      refreshReviewPackage(taskStore, taskId);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        runningTasks.unregister(taskId);
        resolve();
      };
      const complete = (result: TaskResult) => {
        if (settled) return;
        try {
          if (result.session_id) {
            taskStore.updateTaskSession(taskId, result.session_id);
          }
          taskStore.updateTaskResult(taskId, result);
          taskStore.updateTaskStatus(taskId, result.status);

          if (worktreeState) {
            try {
              const gitManager = GitWorktreeManager.fromWorktreeState(worktreeState);
              const summary = gitManager.getDiffSummaryForState(
                taskId,
                worktreeState,
                task.config.editable_paths
              );
              worktreeState = {
                ...worktreeState,
                diff_summary: summary.diffStat,
                out_of_bounds_files: summary.outOfBoundsFiles,
                has_out_of_bounds_changes: summary.hasOutOfBoundsChanges,
              };
              taskStore.updateTaskWorktree(taskId, worktreeState);
            } catch (err) {
              process.stderr.write(`[reply-task] 获取 diff 摘要失败: ${err}\n`);
            }
          }
          refreshReviewPackage(taskStore, taskId);
        } finally {
          finish();
        }
      };
      const fail = (error: string) => {
        if (settled) return;
        try {
          taskStore.updateTaskStatus(taskId, "failed", error);
          refreshReviewPackage(taskStore, taskId);
        } finally {
          finish();
        }
      };

      try {
        const handle = runTask(
          {
            mimoNodePath: config.mimoNodePath,
            mimoEntryPath: config.mimoEntryPath,
            task: { ...task, config: taskConfig },
            runtimeDir: config.runtimeDir,
            timeoutMs: task.config.runtime_timeout_seconds * 1000,
          },
          complete,
          fail
        );

        if (!settled) {
          runningTasks.register(taskId, () => {
            handle.cancel();
            finish();
          });
        }
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return {
    schema: ReplyTaskSchema,
    handler: async (input: ReplyTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (task.status !== "waiting" && task.status !== "review" && task.status !== "queued") {
        return { error: `任务状态不允许回复: ${task.status}` };
      }

      if (!task.session_id) {
        return { error: "任务没有会话 ID，无法回复" };
      }

      const sessionValidation = validateSessionId(task.session_id);
      if (!sessionValidation.allowed) {
        return { error: sessionValidation.reason };
      }

      if (task.current_round > task.config.max_rounds) {
        return { error: `已达到最大沟通轮数: ${task.config.max_rounds}` };
      }

      if (taskQueue.hasQueued(task.task_id)) {
        return { error: `任务回复已在队列中: ${task.task_id}` };
      }

      writeReplyBrief(input.message, task.task_id, task.current_round, `${config.runtimeDir}/briefs`);

      const taskId = task.task_id;

      const startedImmediately = taskQueue.enqueue({
        taskId,
        priority: input.priority,
        enqueuedAt: Date.now(),
        execute: async () => {
          taskStore.updateTaskStatus(taskId, "running");
          await executeReply(taskId);
        },
        cancel: () => {
          taskStore.updateTaskStatus(taskId, "cancelled");
        },
      });

      if (!startedImmediately) {
        taskStore.updateTaskStatus(taskId, "queued");
        return {
          task_id: taskId,
          status: "queued",
          queue_position: taskQueue.size,
        };
      }

      return {
        task_id: taskId,
        status: "running",
      };
    },
    cancelTask: (taskId: string) => {
      if (taskQueue.cancel(taskId)) {
        return true;
      }
      return runningTasks.cancel(taskId);
    },
  };
}
