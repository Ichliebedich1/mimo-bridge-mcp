import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";

export const FinishTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  status: z.enum(["accepted", "abandoned"]),
});

export type FinishTaskInput = z.infer<typeof FinishTaskSchema>;

export function createFinishTaskHandler(taskStore: TaskStore) {
  return {
    schema: FinishTaskSchema,
    handler: async (input: FinishTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      if (task.status !== "review") {
        return { error: `任务状态不允许完成: ${task.status}` };
      }

      taskStore.updateTaskStatus(input.task_id, input.status);
      return {
        task_id: input.task_id,
        status: input.status,
      };
    },
  };
}
