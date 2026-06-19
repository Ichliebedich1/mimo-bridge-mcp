import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { globalRunningTasks, type RunningTaskRegistry } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";

export interface CancelTaskDependencies {
  runningTasks?: RunningTaskRegistry;
  taskQueue?: TaskQueue;
}

export const CancelTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
});

export type CancelTaskInput = z.infer<typeof CancelTaskSchema>;

export function createCancelTaskHandler(
  taskStore: TaskStore,
  dependencies: CancelTaskDependencies = {}
) {
  const runningTasks = dependencies.runningTasks ?? globalRunningTasks;
  const taskQueue = dependencies.taskQueue ?? globalTaskQueue;

  return {
    schema: CancelTaskSchema,
    handler: async (input: CancelTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (task.status !== "running" && task.status !== "waiting" && task.status !== "queued") {
        return { error: `任务状态不允许取消: ${task.status}` };
      }

      if (taskQueue.cancel(input.task_id)) {
        taskStore.updateTaskStatus(input.task_id, "cancelled");
        return {
          task_id: input.task_id,
          status: "cancelled",
        };
      }

      if (runningTasks.cancel(input.task_id)) {
        taskStore.updateTaskStatus(input.task_id, "cancelled");
        return {
          task_id: input.task_id,
          status: "cancelled",
        };
      }

      taskStore.updateTaskStatus(input.task_id, "cancelled");
      return {
        task_id: input.task_id,
        status: "cancelled",
      };
    },
  };
}
