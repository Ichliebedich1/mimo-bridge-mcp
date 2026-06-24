import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createWaitTaskHandler, WaitTaskSchema, type WaitTaskDependencies } from "./wait-task.js";

export const AgentWaitTaskSchema = WaitTaskSchema.extend({
  agent_id: z.string().min(1).optional(),
});

export type AgentWaitTaskInput = z.infer<typeof AgentWaitTaskSchema>;

export function createAgentWaitTaskHandler(taskStore: TaskStore, dependencies: WaitTaskDependencies = {}) {
  const waitTask = createWaitTaskHandler(taskStore, dependencies);

  return {
    schema: AgentWaitTaskSchema,
    handler: async (input: AgentWaitTaskInput) => {
      const task = taskStore.getTask(input.task_id);
      if (!task) {
        return waitTask.handler(input);
      }
      if (input.agent_id && task.agent !== input.agent_id) {
        return {
          error: `Task ${input.task_id} belongs to agent ${task.agent}, not ${input.agent_id}`,
        };
      }

      const result = await waitTask.handler(input);
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
