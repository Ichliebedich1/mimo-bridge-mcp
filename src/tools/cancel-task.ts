import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { globalRunningTasks } from "../services/running-tasks.js";

export const CancelTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
});

export type CancelTaskInput = z.infer<typeof CancelTaskSchema>;

export function createCancelTaskHandler(taskStore: TaskStore) {
  return {
    schema: CancelTaskSchema,
    handler: async (input: CancelTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (task.status !== "running" && task.status !== "waiting") {
        return { error: `任务状态不允许取消: ${task.status}` };
      }

      const cancelled = globalRunningTasks.cancel(input.task_id);
      if (cancelled) {
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
