import { z } from "zod";
import type { AgentRegistry } from "../services/agent-registry.js";

export const AgentListSchema = z.object({});

export type AgentListInput = z.infer<typeof AgentListSchema>;

export function createAgentListHandler(agentRegistry: AgentRegistry) {
  return {
    schema: AgentListSchema,
    handler: async (_input: AgentListInput) => agentRegistry.listAgents(),
  };
}
