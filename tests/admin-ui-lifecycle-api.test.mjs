import { test } from "node:test";
import assert from "node:assert";

import { cancelTask, createTask, deleteTask, finishTask, openTaskTarget, saveRoutingProfiles, worktreeTask } from "../apps/admin-ui/src/api.ts";

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

test("admin UI create task API sends routing fields to MiMo and Reasonix routes", async () => {
  const mock = installFetchMock();
  const baseInput = {
    objective: "route task",
    workspace_path: "C:\\repo",
    editable_paths: ["src"],
    readonly_paths: [],
    acceptance_criteria: [],
    max_rounds: 5,
    runtime_timeout_seconds: 900,
    use_worktree: true,
    priority: 5,
    scope_mode: "strict",
    include_tests: "auto",
    repo_wide_confirmed: false,
    routing_mode: "manual",
    task_scenario: "complex",
    model: "mimo-v2.5-pro",
    reasoning_effort: "high",
    has_images: false,
  };

  try {
    await createTask({ ...baseInput, agent_id: "mimo" });
    await createTask({ ...baseInput, agent_id: "reasonix-tui", model: "deepseek-v4-pro" });

    assert.deepStrictEqual(
      mock.calls.map((call) => [call.method, call.path]),
      [
        ["POST", "/api/tasks"],
        ["POST", "/api/agent-tasks"],
      ]
    );
    assert.strictEqual(mock.calls[0].body.agent_id, undefined);
    assert.strictEqual(mock.calls[0].body.routing_mode, "manual");
    assert.strictEqual(mock.calls[0].body.task_scenario, "complex");
    assert.strictEqual(mock.calls[0].body.model, "mimo-v2.5-pro");
    assert.strictEqual(mock.calls[0].body.reasoning_effort, "high");
    assert.strictEqual(mock.calls[1].body.agent_id, "reasonix-tui");
    assert.strictEqual(mock.calls[1].body.model, "deepseek-v4-pro");
  } finally {
    mock.restore();
  }
});

test("admin UI routing settings API saves profiles with PUT", async () => {
  const mock = installFetchMock();
  try {
    await saveRoutingProfiles({
      scenarios: {
        normal: {
          current: {
            agent_id: "reasonix-tui",
            model: "deepseek-v4-flash",
            reasoning_effort: "medium",
          },
        },
      },
    });

    assert.strictEqual(mock.calls.length, 1);
    assert.strictEqual(mock.calls[0].method, "PUT");
    assert.strictEqual(mock.calls[0].path, "/api/routing-profiles");
    assert.strictEqual(mock.calls[0].body.scenarios.normal.current.agent_id, "reasonix-tui");
  } finally {
    mock.restore();
  }
});
