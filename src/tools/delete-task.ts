import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";

const DELETABLE_STATUSES = new Set(["accepted", "failed", "cancelled", "abandoned"]);

export const DeleteTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
});

export type DeleteTaskInput = z.infer<typeof DeleteTaskSchema>;

export function createDeleteTaskHandler(taskStore: TaskStore) {
  return {
    schema: DeleteTaskSchema,
    handler: async (input: DeleteTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }
      if (!DELETABLE_STATUSES.has(task.status)) {
        return { error: `任务状态不允许删除: ${task.status}` };
      }
      if (task.worktree) {
        return { error: "任务仍有关联 Worktree，请先合并或丢弃" };
      }
      if (!taskStore.deleteTask(input.task_id)) {
        return { error: `删除任务失败: ${input.task_id}` };
      }
      return {
        task_id: input.task_id,
        status: "deleted",
      };
    },
  };
}
