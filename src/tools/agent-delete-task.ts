import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createDeleteTaskHandler } from "./delete-task.js";
import { assertAgentMatches, withAgentField } from "./agent-lifecycle.js";

export const AgentDeleteTaskSchema = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
});

export type AgentDeleteTaskInput = z.infer<typeof AgentDeleteTaskSchema>;

export function createAgentDeleteTaskHandler(taskStore: TaskStore) {
  const deleteTask = createDeleteTaskHandler(taskStore);

  return {
    schema: AgentDeleteTaskSchema,
    handler: async (input: AgentDeleteTaskInput) => {
      const agentCheck = assertAgentMatches(taskStore, input.task_id, input.agent_id);
      if (agentCheck.error) {
        return { error: agentCheck.error };
      }
      const result = await deleteTask.handler({ task_id: input.task_id });
      return withAgentField(result, agentCheck.agent);
    },
  };
}
