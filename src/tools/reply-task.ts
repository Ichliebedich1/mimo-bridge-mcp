import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";
import { validateSessionId } from "../services/path-guard.js";
import { writeReplyBrief } from "../services/prompt-builder.js";
import { runMimoTask } from "../services/mimo-runner.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";

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

  function executeReply(taskId: string) {
    const task = taskStore.getTask(taskId);
    if (!task) return;

    const handle = runTask(
      {
        mimoNodePath: config.mimoNodePath,
        mimoEntryPath: config.mimoEntryPath,
        task,
        runtimeDir: config.runtimeDir,
        timeoutMs: task.config.runtime_timeout_seconds * 1000,
      },
      (result: TaskResult) => {
        if (result.session_id) {
          taskStore.updateTaskSession(taskId, result.session_id);
        }
        taskStore.updateTaskResult(taskId, result);
        taskStore.updateTaskStatus(taskId, result.status);
        runningTasks.unregister(taskId);
      },
      (error: string) => {
        taskStore.updateTaskStatus(taskId, "failed", error);
        runningTasks.unregister(taskId);
      }
    );

    runningTasks.register(taskId, handle.cancel);
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

      writeReplyBrief(input.message, task.task_id, task.current_round, `${config.runtimeDir}/briefs`);

      const taskId = task.task_id;

      if (runningTasks.hasAny()) {
        taskStore.updateTaskStatus(taskId, "queued");

        taskQueue.enqueue({
          taskId,
          priority: input.priority,
          enqueuedAt: Date.now(),
          execute: async () => {
            taskStore.updateTaskStatus(taskId, "running");
            executeReply(taskId);
          },
          cancel: () => {
            taskStore.updateTaskStatus(taskId, "cancelled");
          },
        });

        return {
          task_id: taskId,
          status: "queued",
          queue_position: taskQueue.size,
        };
      }

      taskStore.updateTaskStatus(taskId, "running");
      executeReply(taskId);

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
