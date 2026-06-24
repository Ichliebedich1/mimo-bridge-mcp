import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createFinishTaskHandler, FinishTaskSchema } from "./finish-task.js";
import { assertAgentMatches, withAgentField } from "./agent-lifecycle.js";

export const AgentFinishTaskSchema = FinishTaskSchema.extend({
  agent_id: z.string().min(1).optional(),
});

export type AgentFinishTaskInput = z.infer<typeof AgentFinishTaskSchema>;

export function createAgentFinishTaskHandler(taskStore: TaskStore) {
  const finishTask = createFinishTaskHandler(taskStore);

  return {
    schema: AgentFinishTaskSchema,
    handler: async (input: AgentFinishTaskInput) => {
      const agentCheck = assertAgentMatches(taskStore, input.task_id, input.agent_id);
      if (agentCheck.error) {
        return { error: agentCheck.error };
      }
      const result = await finishTask.handler({
        task_id: input.task_id,
        status: input.status,
      });
      return withAgentField(result, agentCheck.agent);
    },
  };
}
