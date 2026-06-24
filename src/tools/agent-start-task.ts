import { z } from "zod";
import type { Config } from "../config.js";
import type { AgentConfig } from "../types.js";
import type { TaskStore } from "../services/task-store.js";
import { runReasonixTuiTask } from "../services/reasonix-tui-runner.js";
import { createStartTaskHandler, StartTaskSchema, type StartTaskDependencies } from "./start-task.js";

export const AgentStartTaskSchema = StartTaskSchema.extend({
  agent_id: z.string().min(1).default("mimo"),
});

export type AgentStartTaskInput = z.infer<typeof AgentStartTaskSchema>;

export function createAgentStartTaskHandler(
  config: Config,
  agents: AgentConfig[],
  taskStore: TaskStore,
  dependencies: StartTaskDependencies = {}
) {
  return {
    schema: AgentStartTaskSchema,
    handler: async (input: AgentStartTaskInput) => {
      const agentId = input.agent_id || "mimo";
      if (agentId === "mimo") {
        const handler = createStartTaskHandler(config, taskStore, {
          ...dependencies,
          agentId: "mimo",
        });
        return handler.handler(input);
      }

      const agent = agents.find((candidate) => candidate.id === agentId);
      if (!agent) {
        return { error: `Unknown agent_id: ${agentId}` };
      }
      if (agent.enabled === false) {
        return { error: `Agent is disabled: ${agentId}` };
      }
      if (agent.kind !== "reasonix-tui") {
        return { error: `Agent does not support task execution yet: ${agentId}` };
      }
      if (!agent.command) {
        return { error: "Reasonix command is not configured." };
      }

      const handler = createStartTaskHandler(config, taskStore, {
        ...dependencies,
        agentId,
        runTask: (options, onResult, onError) => runReasonixTuiTask(
          {
            agent,
            task: options.task,
            runtimeDir: options.runtimeDir,
            timeoutMs: options.timeoutMs,
          },
          onResult,
          onError
        ),
      });
      return handler.handler(input);
    },
  };
}
