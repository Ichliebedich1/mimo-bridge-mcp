import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import type { TaskResult } from "../types.js";

export const ListTasksSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
});

export type ListTasksInput = z.infer<typeof ListTasksSchema>;

export function createListTasksHandler(taskStore: TaskStore) {
  return {
    schema: ListTasksSchema,
    handler: async (input: ListTasksInput) => {
      const tasks = taskStore.listTasks(input.limit);

      const results: TaskResult[] = tasks.map((task) => ({
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
        stderr_log_path: task.stderr_log_path,
        error: task.error,
      }));

      return { tasks: results };
    },
  };
}
