import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";

export const AgentTaskIdSchema = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().min(1).optional(),
});

export type AgentTaskIdInput = z.infer<typeof AgentTaskIdSchema>;

export function assertAgentMatches(taskStore: TaskStore, taskId: string, agentId?: string): { agent?: string; error?: string } {
  const task = taskStore.getTask(taskId);
  if (!task) {
    return {};
  }
  if (agentId && task.agent !== agentId) {
    return {
      error: `Task ${taskId} belongs to agent ${task.agent}, not ${agentId}`,
    };
  }
  return { agent: task.agent };
}

export function withAgentField(result: unknown, agent?: string): unknown {
  if (!agent || !isRecord(result) || "error" in result) {
    return result;
  }
  return {
    ...result,
    agent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
