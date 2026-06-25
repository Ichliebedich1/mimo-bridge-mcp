import { test } from "node:test";
import assert from "node:assert";

import {
  canAbandonTaskStatus,
  canAcceptTaskStatus,
  canCancelTaskStatus,
  canDiscardWorktreeStatus,
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

