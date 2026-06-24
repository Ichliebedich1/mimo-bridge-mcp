import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";

const TERMINAL_STATUSES = new Set(["accepted", "failed", "cancelled", "abandoned"]);
const MAX_SCAN_TASKS = 200;

export const AgentListTasksSchema = z.object({
  agent_id: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type AgentListTasksInput = z.infer<typeof AgentListTasksSchema>;

export function createAgentListTasksHandler(taskStore: TaskStore) {
  return {
    schema: AgentListTasksSchema,
    handler: async (input: AgentListTasksInput) => {
      const tasks = taskStore
        .listTasks(input.agent_id ? MAX_SCAN_TASKS : input.limit)
        .filter((task) => !input.agent_id || task.agent === input.agent_id)
        .slice(0, input.limit)
        .map((task) => {
          const safeDelete = computeSafeDelete(task.status, Boolean(task.worktree));
          return {
            task_id: task.task_id,
            agent: task.agent,
            status: task.status,
            objective: task.config.objective,
            summary: sanitizeTaskSummary(task.summary),
            modified_files_count: task.modified_files.length,
            risk_flags: task.review_package?.risk_flags ?? [],
            review_recommendation: task.review_package?.review_recommendation ?? null,
            created_at: task.created_at,
            updated_at: task.updated_at,
            current_round: task.current_round,
            has_worktree: Boolean(task.worktree),
            can_delete: safeDelete.can_delete,
            delete_blockers: safeDelete.delete_blockers,
          };
        });

      return {
        agent_id: input.agent_id ?? null,
        returned_count: tasks.length,
        tasks,
      };
    },
  };
}

function sanitizeTaskSummary(value: string): string {
  const cleaned = value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/[A-Z]:\\[^\r\n"']*/gi, "[local path]")
    .replace(/\/(?:home|tmp|var|usr|opt)\/[^\s"']*/gi, "[local path]")
    .replace(/\bses_[A-Za-z0-9_-]+\b/g, "[session]")
    .replace(/\bsession(?:_id|ID)?\b/gi, "[session]")
    .replace(/\bstdin\b/gi, "[stdin]")
    .replace(/\b(?:secret[_-]?)?token[_:-]?[A-Za-z0-9_.-]+\b/gi, "[redacted-token]")
    .replace(/\b(api[_-]?key|authorization)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bpassword\b\s*[:=]\s*\S+/gi, "password=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 500) {
    return cleaned;
  }
  return `${cleaned.slice(0, 500)} [truncated]`;
}

function computeSafeDelete(status: string, hasWorktree: boolean): { can_delete: boolean; delete_blockers: string[] } {
  const blockers: string[] = [];
  if (!TERMINAL_STATUSES.has(status)) {
    blockers.push("task is not terminal");
  }
  if (hasWorktree) {
    blockers.push("task still has a Worktree");
  }
  return {
    can_delete: blockers.length === 0,
    delete_blockers: blockers,
  };
}
