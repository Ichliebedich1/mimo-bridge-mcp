import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { createGetTaskHandler } from "./get-task.js";

const WaitDetailLevelSchema = z.enum(["summary", "review"]);

export const WaitTaskSchema = z.object({
  task_id: z.string().min(1, "任务 ID 不能为空"),
  timeout_seconds: z.number().int().min(1).max(600).default(300),
  detail_level: WaitDetailLevelSchema.default("review"),
  max_chars: z.number().int().min(1000).max(20000).default(8000),
});

export type WaitTaskInput = z.infer<typeof WaitTaskSchema>;

export interface WaitTaskDependencies {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
}

export function createWaitTaskHandler(taskStore: TaskStore, dependencies: WaitTaskDependencies = {}) {
  const getTask = createGetTaskHandler(taskStore);
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const pollIntervalMs = dependencies.pollIntervalMs ?? 1000;

  return {
    schema: WaitTaskSchema,
    handler: async (input: WaitTaskInput) => {
      const startedAt = now();
      const deadline = startedAt + (input.timeout_seconds ?? 300) * 1000;
      let task = taskStore.getTask(input.task_id);
      if (!task) {
        return { error: `任务不存在: ${input.task_id}` };
      }

      while (isActive(task.status) && now() < deadline) {
        await sleep(Math.max(1, Math.min(pollIntervalMs, deadline - now())));
        task = taskStore.getTask(input.task_id);
        if (!task) {
          return { error: `等待期间任务被删除: ${input.task_id}` };
        }
      }

      const waitedMs = Math.max(0, now() - startedAt);
      if (isActive(task.status)) {
        return {
          task_id: task.task_id,
          status: task.status,
          completed: false,
          timed_out: true,
          waited_ms: waitedMs,
        };
      }

      const detail = await getTask.handler({
        task_id: task.task_id,
        detail_level: input.detail_level ?? "review",
        max_chars: input.max_chars ?? 8000,
        log_tail_lines: 20,
        include_diff: false,
        include_logs: false,
        include_files: false,
        file_paths: [],
        diff_paths: [],
      });

      return {
        ...detail,
        timed_out: false,
        waited_ms: waitedMs,
      };
    },
  };
}

function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}
