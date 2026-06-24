import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskStore } from "../dist/services/task-store.js";
import { createAgentCancelTaskHandler } from "../dist/tools/agent-cancel-task.js";
import { createAgentFinishTaskHandler } from "../dist/tools/agent-finish-task.js";
import { createAgentDeleteTaskHandler } from "../dist/tools/agent-delete-task.js";
import { createAgentMergeTaskHandler } from "../dist/tools/agent-merge-task.js";
import { createAgentQueueStatusHandler } from "../dist/tools/agent-queue-status.js";

function createFixture(agent = "reasonix-tui") {
  const runtimeDir = mkdtempSync(join(tmpdir(), "agent-lifecycle-"));
  const store = new TaskStore(runtimeDir);
  const task = store.createTask(
    {
      objective: "agent lifecycle task",
      workspace_path: runtimeDir,
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 3,
      runtime_timeout_seconds: 60,
    },
    { agent }
  );
  return { runtimeDir, store, task, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) };
}

test("agent_cancel_task cancels a matching Reasonix task and returns agent id", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    const handler = createAgentCancelTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
    });

    assert.strictEqual(result.task_id, fixture.task.task_id);
    assert.strictEqual(result.status, "cancelled");
    assert.strictEqual(result.agent, "reasonix-tui");
    assert.strictEqual(fixture.store.getTask(fixture.task.task_id).status, "cancelled");
  } finally {
    fixture.cleanup();
  }
});

test("agent lifecycle tools reject mismatched agent_id before mutating state", async () => {
  const fixture = createFixture("reasonix-tui");
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "running");
    const handler = createAgentCancelTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "mimo",
    });

    assert.match(result.error, /belongs to agent reasonix-tui/);
    assert.strictEqual(fixture.store.getTask(fixture.task.task_id).status, "running");
  } finally {
    fixture.cleanup();
  }
});

test("agent_finish_task accepts a matching Reasonix review task", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "review");
    const handler = createAgentFinishTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
      status: "accepted",
    });

    assert.strictEqual(result.task_id, fixture.task.task_id);
    assert.strictEqual(result.status, "accepted");
    assert.strictEqual(result.agent, "reasonix-tui");
    assert.strictEqual(fixture.store.getTask(fixture.task.task_id).status, "accepted");
  } finally {
    fixture.cleanup();
  }
});

test("agent_delete_task deletes a matching terminal Reasonix task", async () => {
  const fixture = createFixture();
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "accepted");
    const handler = createAgentDeleteTaskHandler(fixture.store);
    const result = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
    });

    assert.strictEqual(result.task_id, fixture.task.task_id);
    assert.strictEqual(result.status, "deleted");
    assert.strictEqual(result.agent, "reasonix-tui");
    assert.strictEqual(fixture.store.getTask(fixture.task.task_id), null);
  } finally {
    fixture.cleanup();
  }
});

test("agent_merge_task enforces agent_id before delegating Worktree operations", async () => {
  const fixture = createFixture("reasonix-tui");
  try {
    fixture.store.updateTaskStatus(fixture.task.task_id, "review");
    const handler = createAgentMergeTaskHandler(fixture.store, { runtimeDir: fixture.runtimeDir });
    const mismatch = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "mimo",
      action: "discard",
    });
    assert.match(mismatch.error, /belongs to agent reasonix-tui/);

    const matched = await handler.handler({
      task_id: fixture.task.task_id,
      agent_id: "reasonix-tui",
      action: "discard",
    });
    assert.match(matched.error, /Worktree/);
  } finally {
    fixture.cleanup();
  }
});

test("agent_queue_status can filter queued tasks by agent_id", async () => {
  const handler = createAgentQueueStatusHandler({
    getQueueStatus: () => ({
      running: 1,
      queued: 3,
      queue: [
        { taskId: "task_mimo", agentId: "mimo", priority: 5, enqueuedAt: 1 },
        { taskId: "task_reasonix_a", agentId: "reasonix-tui", priority: 5, enqueuedAt: 2 },
        { taskId: "task_reasonix_b", agentId: "reasonix-tui", priority: 4, enqueuedAt: 3 },
      ],
    }),
  });

  const result = await handler.handler({ agent_id: "reasonix-tui" });
  assert.strictEqual(result.agent_id, "reasonix-tui");
  assert.deepStrictEqual(
    result.queue.map((task) => task.taskId),
    ["task_reasonix_a", "task_reasonix_b"]
  );
});
