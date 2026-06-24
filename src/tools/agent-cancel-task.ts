import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createCancelTaskHandler, type CancelTaskDependencies } from "./cancel-task.js";
import { assertAgentMatches, withAgentField } from "./agent-lifecycle.js";

export const AgentCancelTaskSchema = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
});

export type AgentCancelTaskInput = z.infer<typeof AgentCancelTaskSchema>;

export function createAgentCancelTaskHandler(
  taskStore: TaskStore,
  dependencies: CancelTaskDependencies = {}
) {
  const cancelTask = createCancelTaskHandler(taskStore, dependencies);

  return {
    schema: AgentCancelTaskSchema,
    handler: async (input: AgentCancelTaskInput) => {
      const agentCheck = assertAgentMatches(taskStore, input.task_id, input.agent_id);
      if (agentCheck.error) {
        return { error: agentCheck.error };
      }
      const result = await cancelTask.handler({ task_id: input.task_id });
      return withAgentField(result, agentCheck.agent);
    },
  };
}
