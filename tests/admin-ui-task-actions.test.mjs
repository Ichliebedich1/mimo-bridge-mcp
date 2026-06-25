import { test } from "node:test";
import assert from "node:assert";

import {
  canAbandonTaskStatus,
  canAcceptTaskStatus,
  canCancelTaskStatus,
  canDiscardWorktreeStatus,
  canReplyTaskStatus,
} from "../apps/admin-ui/src/task-actions.ts";

test("admin UI action rules allow cleanup for failed and cancelled tasks", () => {
  for (const status of ["review", "failed", "cancelled", "abandoned"]) {
    assert.strictEqual(canDiscardWorktreeStatus(status), true, status);
    assert.strictEqual(canAbandonTaskStatus(status), true, status);
  }
});

test("admin UI action rules keep accept and cancel scoped to valid states", () => {
  assert.strictEqual(canAcceptTaskStatus("review"), true);
  for (const status of ["failed", "cancelled", "abandoned", "running"]) {
    assert.strictEqual(canAcceptTaskStatus(status), false, status);
  }

  for (const status of ["queued", "running", "waiting"]) {
    assert.strictEqual(canCancelTaskStatus(status), true, status);
  }
  for (const status of ["review", "failed", "cancelled", "abandoned", "accepted"]) {
    assert.strictEqual(canCancelTaskStatus(status), false, status);
  }
});

test("admin UI action rules allow replies for failed tasks so agents can continue", () => {
  for (const status of ["waiting", "review", "failed"]) {
    assert.strictEqual(canReplyTaskStatus(status), true, status);
  }
  for (const status of ["queued", "running", "cancelled", "abandoned", "accepted"]) {
    assert.strictEqual(canReplyTaskStatus(status), false, status);
  }
});
