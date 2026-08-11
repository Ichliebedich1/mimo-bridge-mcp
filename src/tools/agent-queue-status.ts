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
        active: base.active.filter((task) => task.agentId === input.agent_id),
      };
    },
  };
}

function defaultQueueStatus() {
  return {
    capacity: globalTaskQueue.capacity,
    running: globalRunningTasks.size,
    queued: globalTaskQueue.size,
    active: globalTaskQueue.getActiveTasks(),
    queue: globalTaskQueue.getQueuedTasks(),
  };
}

function normalizeQueueStatus(value: unknown): { capacity: number; running: number; queued: number; active: Array<Record<string, unknown>>; queue: Array<Record<string, unknown>> } {
  if (!isRecord(value)) {
    return { capacity: 8, running: 0, queued: 0, active: [], queue: [] };
  }
  const queue = Array.isArray(value.queue) ? value.queue.filter(isRecord) : [];
  const active = Array.isArray(value.active) ? value.active.filter(isRecord) : [];
  return {
    capacity: typeof value.capacity === "number" ? value.capacity : 8,
    running: typeof value.running === "number" ? value.running : 0,
    queued: typeof value.queued === "number" ? value.queued : queue.length,
    active,
    queue,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
