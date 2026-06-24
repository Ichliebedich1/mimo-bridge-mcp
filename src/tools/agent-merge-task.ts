import { z } from "zod";
import type { Config } from "../config.js";
import type { TaskStore } from "../services/task-store.js";
import { createMergeTaskHandler, MergeTaskSchema } from "./merge-task.js";
import { assertAgentMatches, withAgentField } from "./agent-lifecycle.js";

export const AgentMergeTaskSchema = MergeTaskSchema.extend({
  agent_id: z.string().min(1).optional(),
});

export type AgentMergeTaskInput = z.infer<typeof AgentMergeTaskSchema>;

export function createAgentMergeTaskHandler(taskStore: TaskStore, config: Pick<Config, "runtimeDir">) {
  const mergeTask = createMergeTaskHandler(taskStore, config);

  return {
    schema: AgentMergeTaskSchema,
    handler: async (input: AgentMergeTaskInput) => {
      const agentCheck = assertAgentMatches(taskStore, input.task_id, input.agent_id);
      if (agentCheck.error) {
        return { error: agentCheck.error };
      }
      const result = await mergeTask.handler({
        task_id: input.task_id,
        action: input.action,
      });
      return withAgentField(result, agentCheck.agent);
    },
  };
}
