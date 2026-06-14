import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";

export const GetTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
});

export type GetTaskInput = z.infer<typeof GetTaskSchema>;

export function createGetTaskHandler(taskStore: TaskStore) {
  return {
    schema: GetTaskSchema,
    handler: async (input: GetTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      const result: TaskResult = {
        task_id: task.task_id,
        agent: task.agent,
        session_id: task.session_id,
        status: task.status,
        summary: task.summary,
        modified_files: task.modified_files,
        test_results: task.test_results,
        questions: task.questions,
        issues: task.issues,
        raw_log_path: task.raw_log_path,
        error: task.error,
      };

      return result;
    },
  };
}
