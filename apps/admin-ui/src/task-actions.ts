import type { TaskStatus } from './types';

const REVIEW_STATUSES = new Set<TaskStatus>(['review']);
const ABANDONABLE_STATUSES = new Set<TaskStatus>(['review', 'failed', 'cancelled', 'abandoned']);
const WORKTREE_DISCARD_STATUSES = new Set<TaskStatus>(['review', 'failed', 'cancelled', 'abandoned']);
const CANCELABLE_STATUSES = new Set<TaskStatus>(['queued', 'running', 'waiting']);

export function canAcceptTaskStatus(status: TaskStatus): boolean {
  return REVIEW_STATUSES.has(status);
}

export function canAbandonTaskStatus(status: TaskStatus): boolean {
  return ABANDONABLE_STATUSES.has(status);
}

export function canDiscardWorktreeStatus(status: TaskStatus): boolean {
  return WORKTREE_DISCARD_STATUSES.has(status);
}

export function canCancelTaskStatus(status: TaskStatus): boolean {
  return CANCELABLE_STATUSES.has(status);
}

