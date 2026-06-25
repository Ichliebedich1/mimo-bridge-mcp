import { z } from "zod";
import type { Config } from "../config.js";
import type { AgentConfig } from "../types.js";
import type { TaskStore } from "../services/task-store.js";
import { runReasonixTuiTask } from "../services/reasonix-tui-runner.js";
import { createStartTaskHandler, StartTaskSchema, type StartTaskDependencies } from "./start-task.js";
import { canAgentHandleMultimodal, selectRoutingAgent, validateModelForAgent } from "../services/model-routing.js";

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
      const { agent_id: _agentId, ...startInput } = input;
      const selectedAgentId = input.agent_id === "auto"
        ? selectRoutingAgent(input, config.routingProfiles)
        : agentId;

      if (selectedAgentId === "mimo") {
        if (input.model) {
          const validation = validateModelForAgent("mimo", input.model);
          if (!validation.ok) return { error: validation.error };
        }
        if (input.task_scenario === "multimodal" && !canAgentHandleMultimodal("mimo")) {
          return { error: "MiMo 不支持多模态任务" };
        }
        const handler = createStartTaskHandler(config, taskStore, {
          ...dependencies,
          agentId: "mimo",
          agentKind: "mimo",
        });
        return handler.handler(startInput);
      }

      const agent = agents.find((candidate) => candidate.id === selectedAgentId);
      if (!agent) {
        return { error: `Unknown agent_id: ${selectedAgentId}` };
      }
      if (agent.enabled === false) {
        return { error: `Agent is disabled: ${selectedAgentId}` };
      }
      if (agent.kind !== "reasonix-tui") {
        return { error: `Agent does not support task execution yet: ${agentId}` };
      }
      if (!agent.command) {
        return { error: "Reasonix command is not configured." };
      }
      if (input.model) {
        const validation = validateModelForAgent(agent.kind, input.model);
        if (!validation.ok) return { error: validation.error };
      }
      if (input.task_scenario === "multimodal" && !canAgentHandleMultimodal(agent.kind)) {
        return { error: "Reasonix 不支持多模态任务，请使用 MiMo 的 mimo-v2.5-flash" };
      }

      const handler = createStartTaskHandler(config, taskStore, {
        ...dependencies,
        agentId: selectedAgentId,
        agentKind: agent.kind,
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
      return handler.handler(startInput);
    },
  };
}
