import type { ReviewRecommendation, TaskState } from "../types.js";
import type { TaskStore } from "./task-store.js";

export interface PendingReviewSummary {
  task_id: string;
  status: "review";
  updated_at: string;
  current_round: number;
  objective: string;
  changed_files_count: number;
  risk_flags: string[];
  review_recommendation: ReviewRecommendation | "unknown";
  has_worktree: boolean;
  origin_codex_thread_id: string | null;
  origin_codex_thread_url: string | null;
  review_command: string;
}

export interface PendingReviewsSnapshot {
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
    .filter((task): task is TaskState & { status: "review" } => task.status === "review");

  const summaries = pendingTasks.map(toPendingReviewSummary);
  const tasks: PendingReviewSummary[] = [];

  for (const summary of summaries.slice(0, limit)) {
    const candidate = buildSnapshot(pendingTasks.length, [...tasks, summary], false);
    if (JSON.stringify(candidate).length > maxChars && tasks.length > 0) {
      break;
    }
    tasks.push(summary);
    if (JSON.stringify(buildSnapshot(pendingTasks.length, tasks, false)).length >= maxChars) {
      break;
    }
  }

  const truncated = tasks.length < pendingTasks.length;
  return buildSnapshot(pendingTasks.length, tasks, truncated);
}

export function getPendingReviewCount(taskStore: TaskStore): number {
  return taskStore.listTasks(MAX_SCAN_LIMIT).filter((task) => task.status === "review").length;
}

function buildSnapshot(pendingCount: number, tasks: PendingReviewSummary[], truncated: boolean): PendingReviewsSnapshot {
  return {
    pending_count: pendingCount,
    returned_count: tasks.length,
    truncated,
    tasks,
    next_review_command: tasks[0]?.review_command ?? null,
    recovery_note:
      pendingCount === 0
        ? "No MiMo tasks are waiting for Codex review."
        : "MiMo has completed task(s) waiting for Codex review. Start with the first review_command and keep using Review Package before focused escalation.",
  };
}

function toPendingReviewSummary(task: TaskState & { status: "review" }): PendingReviewSummary {
  const reviewPackage = task.review_package;
  return {
    task_id: task.task_id,
    status: "review",
    updated_at: task.updated_at,
    current_round: task.current_round,
    objective: truncateText(task.config.objective, OBJECTIVE_PREVIEW_CHARS),
    changed_files_count: reviewPackage?.changed_files_count ?? task.modified_files.length,
    risk_flags: reviewPackage?.risk_flags ?? [],
    review_recommendation: reviewPackage?.review_recommendation ?? "unknown",
    has_worktree: Boolean(task.worktree),
    origin_codex_thread_id: task.config.origin_codex_thread_id ?? null,
    origin_codex_thread_url: task.config.origin_codex_thread_url ?? null,
    review_command: `node scripts\\mimo-bridge-client.mjs review --task-id ${task.task_id} --detail-level review --max-chars 8000`,
  };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}
