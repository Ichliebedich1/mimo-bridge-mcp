import { test } from "node:test";
import assert from "node:assert";

import { cancelTask, deleteTask, finishTask, openTaskTarget, worktreeTask } from "../apps/admin-ui/src/api.ts";

function installFetchMock() {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    calls.push({
      path: String(path),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    return new Response(JSON.stringify({ ok: true, data: { task_id: "task_1", status: "ok" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

test("admin UI lifecycle API uses generic agent routes for non-MiMo tasks", async () => {
  const mock = installFetchMock();
  try {
    await cancelTask("task_1", "reasonix-tui");
    await finishTask("task_1", "accepted", "reasonix-tui");
    await worktreeTask("task_1", "merge", "reasonix-tui");
    await openTaskTarget("task_1", "session_folder", "reasonix-tui");
    await deleteTask("task_1", "reasonix-tui");

    assert.deepStrictEqual(
      mock.calls.map((call) => [call.method, call.path]),
      [
        ["POST", "/api/agent-tasks/task_1/cancel"],
        ["POST", "/api/agent-tasks/task_1/finish"],
        ["POST", "/api/agent-tasks/task_1/worktree"],
        ["POST", "/api/agent-tasks/task_1/open"],
        ["DELETE", "/api/agent-tasks/task_1?agent_id=reasonix-tui"],
      ]
    );
    assert.strictEqual(mock.calls[0].body.agent_id, "reasonix-tui");
    assert.strictEqual(mock.calls[1].body.agent_id, "reasonix-tui");
    assert.strictEqual(mock.calls[1].body.status, "accepted");
    assert.strictEqual(mock.calls[2].body.agent_id, "reasonix-tui");
    assert.strictEqual(mock.calls[2].body.action, "merge");
    assert.strictEqual(mock.calls[3].body.agent_id, "reasonix-tui");
    assert.strictEqual(mock.calls[3].body.action, "session_folder");
  } finally {
    mock.restore();
  }
});

test("admin UI lifecycle API keeps MiMo tasks on legacy routes", async () => {
  const mock = installFetchMock();
  try {
    await cancelTask("task_1", "mimo");
    await finishTask("task_1", "accepted", "mimo");
    await worktreeTask("task_1", "merge", "mimo");
    await openTaskTarget("task_1", "task_folder", "mimo");
    await deleteTask("task_1", "mimo");

    assert.deepStrictEqual(
      mock.calls.map((call) => [call.method, call.path]),
      [
        ["POST", "/api/tasks/task_1/cancel"],
        ["POST", "/api/tasks/task_1/finish"],
        ["POST", "/api/tasks/task_1/worktree"],
        ["POST", "/api/tasks/task_1/open"],
        ["DELETE", "/api/tasks/task_1"],
      ]
    );
    assert.deepStrictEqual(mock.calls[0].body, {});
    assert.deepStrictEqual(mock.calls[1].body, { status: "accepted" });
    assert.deepStrictEqual(mock.calls[2].body, { action: "merge" });
    assert.deepStrictEqual(mock.calls[3].body, { action: "task_folder" });
  } finally {
    mock.restore();
  }
});
