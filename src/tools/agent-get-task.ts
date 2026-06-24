import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createGetTaskHandler, GetTaskSchema } from "./get-task.js";

export const AgentGetTaskSchema = GetTaskSchema.extend({
  agent_id: z.string().min(1).optional(),
});

export type AgentGetTaskInput = z.infer<typeof AgentGetTaskSchema>;

export function createAgentGetTaskHandler(taskStore: TaskStore) {
  const getTask = createGetTaskHandler(taskStore);

  return {
    schema: AgentGetTaskSchema,
    handler: async (input: AgentGetTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return getTask.handler(input);
      }
      if (input.agent_id && task.agent !== input.agent_id) {
        return {
          error: `Task ${input.task_id} belongs to agent ${task.agent}, not ${input.agent_id}`,
        };
      }

      const result = await getTask.handler(input);
      if (isRecord(result) && !("error" in result)) {
        return {
          ...result,
          agent: task.agent,
        };
      }
      return result;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
