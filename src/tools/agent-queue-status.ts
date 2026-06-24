import { z } from "zod";
import { globalRunningTasks } from "../services/running-tasks.js";
import { globalTaskQueue, type TaskQueue } from "../services/task-queue.js";

export const AgentQueueStatusSchema = z.object({
  agent_id: z.string().min(1).optional(),
});

export type AgentQueueStatusInput = z.infer<typeof AgentQueueStatusSchema>;

export interface AgentQueueStatusDependencies {
  getQueueStatus?: () => unknown;
  taskQueue?: TaskQueue;
}

export function createAgentQueueStatusHandler(dependencies: AgentQueueStatusDependencies = {}) {
  return {
    schema: AgentQueueStatusSchema,
    handler: async (input: AgentQueueStatusInput = {}) => {
      const base = normalizeQueueStatus(dependencies.getQueueStatus?.() ?? defaultQueueStatus());
      if (!input.agent_id) {
        return base;
      }
      return {
        ...base,
        agent_id: input.agent_id,
        queue: base.queue.filter((task) => task.agentId === input.agent_id),
      };
    },
  };
}

function defaultQueueStatus() {
  return {
    running: globalRunningTasks.size,
    queued: globalTaskQueue.size,
    queue: globalTaskQueue.getQueuedTasks(),
  };
}

function normalizeQueueStatus(value: unknown): { running: number; queued: number; queue: Array<Record<string, unknown>> } {
  if (!isRecord(value)) {
    return { running: 0, queued: 0, queue: [] };
  }
  const queue = Array.isArray(value.queue) ? value.queue.filter(isRecord) : [];
  return {
    running: typeof value.running === "number" ? value.running : 0,
    queued: typeof value.queued === "number" ? value.queued : queue.length,
    queue,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
