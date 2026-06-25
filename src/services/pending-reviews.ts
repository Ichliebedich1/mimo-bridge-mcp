import type { ReviewRecommendation, TaskState, TaskStatus } from "../types.js";
import type { TaskStore } from "./task-store.js";

type RecoverableStatus = Extract<TaskStatus, "review" | "failed" | "cancelled" | "abandoned">;

export interface PendingReviewSummary {
  task_id: string;
  agent: string;
  status: RecoverableStatus;
  updated_at: string;
  current_round: number;
  objective: string;
  changed_files_count: number;
  risk_flags: string[];
  review_recommendation: ReviewRecommendation | "unknown";
  has_worktree: boolean;
  attention_reason: "needs_review" | "failed_needs_attention" | "terminal_worktree_cleanup";
  origin_codex_thread_id: string | null;
  origin_codex_thread_url: string | null;
  review_command: string;
}

export interface PendingReviewsSnapshot {
  agent_id: string | null;
  pending_count: number;
  returned_count: number;
  truncated: boolean;
  tasks: PendingReviewSummary[];
  next_review_command: string | null;
  recovery_note: string;
}

export interface PendingReviewsOptions {
  limit?: number;
  max_chars?: number;
  agent_id?: string;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_CHARS = 8000;
const MAX_SCAN_LIMIT = 200;
const OBJECTIVE_PREVIEW_CHARS = 180;

export function getPendingReviewsSnapshot(
  taskStore: TaskStore,
  options: PendingReviewsOptions = {}
): PendingReviewsSnapshot {
  const limit = clampInteger(options.limit, 1, 50, DEFAULT_LIMIT);
  const maxChars = clampInteger(options.max_chars, 1000, 20000, DEFAULT_MAX_CHARS);
  const pendingTasks = taskStore
    .listTasks(MAX_SCAN_LIMIT)
    .filter(isRecoverableTask)
    .filter((task) => !options.agent_id || task.agent === options.agent_id);

  const summaries = pendingTasks.map(toPendingReviewSummary);
  const tasks: PendingReviewSummary[] = [];

  for (const summary of summaries.slice(0, limit)) {
    const candidate = buildSnapshot(pendingTasks.length, [...tasks, summary], false, options.agent_id ?? null);
    if (JSON.stringify(candidate).length > maxChars && tasks.length > 0) {
      break;
    }
    tasks.push(summary);
    if (JSON.stringify(buildSnapshot(pendingTasks.length, tasks, false, options.agent_id ?? null)).length >= maxChars) {
      break;
    }
  }

  const truncated = tasks.length < pendingTasks.length;
  return buildSnapshot(pendingTasks.length, tasks, truncated, options.agent_id ?? null);
}

export function getPendingReviewCount(taskStore: TaskStore, agentId?: string): number {
  return taskStore
    .listTasks(MAX_SCAN_LIMIT)
    .filter(isRecoverableTask)
    .filter((task) => !agentId || task.agent === agentId).length;
}

function buildSnapshot(
  pendingCount: number,
  tasks: PendingReviewSummary[],
  truncated: boolean,
  agentId: string | null
): PendingReviewsSnapshot {
  return {
    agent_id: agentId,
    pending_count: pendingCount,
    returned_count: tasks.length,
    truncated,
    tasks,
    next_review_command: tasks[0]?.review_command ?? null,
    recovery_note:
      pendingCount === 0
        ? "No tasks are waiting for Codex review or intervention."
        : "Task(s) need Codex review or intervention. Start with the first review_command and keep using Review Package before focused escalation.",
  };
}

function isRecoverableTask(task: TaskState): task is TaskState & { status: RecoverableStatus } {
  if (task.status === "review") {
    return true;
  }
  if (task.status === "failed") {
    return Boolean(task.worktree || task.error || task.issues.length > 0 || (task.review_package?.risk_flags.length ?? 0) > 0);
  }
  if ((task.status === "cancelled" || task.status === "abandoned") && task.worktree) {
    return true;
  }
  return false;
}

function toPendingReviewSummary(task: TaskState & { status: RecoverableStatus }): PendingReviewSummary {
  const reviewPackage = task.review_package;
  return {
    task_id: task.task_id,
    agent: task.agent,
    status: task.status,
    updated_at: task.updated_at,
    current_round: task.current_round,
    objective: truncateText(task.config.objective, OBJECTIVE_PREVIEW_CHARS),
    changed_files_count: reviewPackage?.changed_files_count ?? task.modified_files.length,
    risk_flags: reviewPackage?.risk_flags ?? [],
    review_recommendation: reviewPackage?.review_recommendation ?? "unknown",
    has_worktree: Boolean(task.worktree),
    attention_reason: getAttentionReason(task),
    origin_codex_thread_id: task.config.origin_codex_thread_id ?? null,
    origin_codex_thread_url: task.config.origin_codex_thread_url ?? null,
    review_command: buildReviewCommand(task),
  };
}

function getAttentionReason(task: TaskState & { status: RecoverableStatus }): PendingReviewSummary["attention_reason"] {
  if (task.status === "review") {
    return "needs_review";
  }
  if (task.status === "failed") {
    return "failed_needs_attention";
  }
  return "terminal_worktree_cleanup";
}

function buildReviewCommand(task: TaskState & { status: RecoverableStatus }): string {
  if (task.agent === "mimo") {
    return `node scripts\\mimo-bridge-client.mjs review --task-id ${task.task_id} --detail-level review --max-chars 8000`;
  }
  return `node scripts\\mimo-bridge-client.mjs agent-review --agent-id ${task.agent} --task-id ${task.task_id} --detail-level review --max-chars 8000`;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}
