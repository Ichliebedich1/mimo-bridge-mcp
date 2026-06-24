import { test } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleAdminApi } from "../apps/local-daemon/dist/apps/local-daemon/src/admin-api.js";
import { TaskStore } from "../dist/services/task-store.js";
import { createDeleteTaskHandler } from "../dist/tools/delete-task.js";
import { createPendingReviewsHandler } from "../dist/tools/pending-reviews.js";
import { createAgentRegistry } from "../dist/services/agent-registry.js";
import { createAgentListHandler } from "../dist/tools/agent-list.js";

function createMockReq(method, body = undefined) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {};
  req[Symbol.asyncIterator] = async function* () {
    if (body !== undefined) {
      yield Buffer.from(JSON.stringify(body), "utf-8");
    }
  };
  return req;
}

function createMockRes() {
  return {
    headersSent: false,
    statusCode: undefined,
    headers: undefined,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    end(chunk = "") {
      this.body += chunk;
    },
  };
}

async function callApi(context, method, path, body) {
  const req = createMockReq(method, body);
  const res = createMockRes();
  const handled = await handleAdminApi(
    req,
    res,
    new URL(path, "http://127.0.0.1:3210"),
    {
      host: "127.0.0.1",
      port: 3210,
      runtimeDir: join(tmpdir(), "unused-runtime"),
      mcpConfig: { agents: [] },
      configError: null,
      mimoVersion: { nodeVersion: "test", cliVersion: "test" },
      agents: [
        {
          id: "mimo",
          kind: "mimo",
          display_name: "MiMo Code",
          enabled: true,
        },
      ],
    },
    context
  );
  assert.strictEqual(handled, true);
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

function createContext() {
  const runtimeDir = mkdtempSync(join(tmpdir(), "admin-api-"));
  const taskStore = new TaskStore(runtimeDir);
  const task = taskStore.createTask({
    objective: "admin api objective",
    workspace_path: "C:\\sensitive\\workspace",
    editable_paths: ["src"],
    readonly_paths: [],
    acceptance_criteria: ["works"],
    max_rounds: 5,
    runtime_timeout_seconds: 900,
  });
  taskStore.updateTaskStatus(task.task_id, "review");
  taskStore.updateTaskWorktree(task.task_id, {
    repo_path: "C:\\sensitive\\repo",
    worktrees_root: "C:\\sensitive\\worktrees",
    worktree_path: "C:\\sensitive\\worktree",
    branch_name: "task/test",
    base_commit: "base",
    base_branch: "main",
    diff_summary: null,
    out_of_bounds_files: [],
    has_out_of_bounds_changes: false,
  });

  const calls = [];
  const agentRegistry = createAgentRegistry({
    agents: [
      {
        id: "mimo",
        kind: "mimo",
        display_name: "MiMo Code",
        enabled: true,
      },
      {
        id: "reasonix-tui",
        kind: "reasonix-tui",
        display_name: "Reasonix TUI",
        enabled: true,
      },
    ],
    mcpConfig: {
      mimoNodePath: process.execPath,
      mimoEntryPath: "fake-mimo.mjs",
      allowedRoots: [runtimeDir],
      runtimeDir,
      agents: [],
    },
    mimoVersion: { nodeVersion: "node-test", cliVersion: "mimo-test" },
  });
  const context = {
    taskStore,
    degraded: false,
    configError: null,
    tools: {
      startTask: {
        handler: async (input) => {
          calls.push(["startTask", input]);
          return { task_id: "task_created", status: "running", worktree_path: "C:\\sensitive\\created-worktree" };
        },
        getQueueStatus: () => ({ running: 0, queued: 0, queue: [] }),
      },
      agentStartTask: {
        handler: async (input) => {
          calls.push(["agentStartTask", input]);
          return { task_id: "task_agent_created", status: "running", agent: input.agent_id };
        },
      },
      agentGetTask: {
        handler: async (input) => {
          calls.push(["agentGetTask", input]);
          return {
            task_id: input.task_id,
            agent: input.agent_id ?? "reasonix-tui",
            agent_session_path: "C:\\sensitive\\reasonix\\session.jsonl",
            status: "review",
            detail_level: input.detail_level,
            task: { config: { workspace_path: "C:\\sensitive\\workspace" } },
            review_package: {
              task_id: input.task_id,
              status: "review",
              objective: "agent api objective",
              changed_files: [],
              changed_files_count: 0,
              diff_stat: "",
              changed_lines_summary: [],
              out_of_bounds_report: { has_changes: false, files: [] },
              test_result: "",
              exit_code: 0,
              mimo_summary: "done",
              risk_flags: [],
              review_recommendation: "approve",
              truncated: false,
            },
          };
        },
      },
      agentWaitTask: {
        handler: async (input) => {
          calls.push(["agentWaitTask", input]);
          return {
            task_id: input.task_id,
            agent: input.agent_id ?? "reasonix-tui",
            agent_session_path: "C:\\sensitive\\reasonix\\session.jsonl",
            status: "review",
            detail_level: input.detail_level,
            timed_out: false,
            waited_ms: 10,
            review_package: {
              task_id: input.task_id,
              status: "review",
              objective: "agent api objective",
              changed_files: [],
              changed_files_count: 0,
              diff_stat: "",
              changed_lines_summary: [],
              out_of_bounds_report: { has_changes: false, files: [] },
              test_result: "",
              exit_code: 0,
              mimo_summary: "done",
              risk_flags: [],
              review_recommendation: "approve",
              truncated: false,
            },
          };
        },
      },
      agentReplyTask: {
        handler: async (input) => {
          calls.push(["agentReplyTask", input]);
          return { task_id: input.task_id, agent: input.agent_id ?? "reasonix-tui", status: "running" };
        },
      },
      getTask: {
        handler: async (input) => {
          calls.push(["getTask", input]);
          return {
            task_id: input.task_id,
            status: "review",
            task: { config: { workspace_path: "C:\\sensitive\\workspace" } },
            review_package: {
              task_id: input.task_id,
              status: "review",
              objective: "admin api objective",
              changed_files: [],
              changed_files_count: 0,
              diff_stat: "",
              changed_lines_summary: [],
              out_of_bounds_report: { has_changes: false, files: [] },
              test_result: "",
              exit_code: 0,
              mimo_summary: "done",
              risk_flags: [],
              review_recommendation: "approve",
              truncated: false,
            },
          };
        },
      },
      replyTask: {
        handler: async (input) => {
          calls.push(["replyTask", input]);
          return { task_id: input.task_id, status: "running" };
        },
      },
      cancelTask: {
        handler: async (input) => {
          calls.push(["cancelTask", input]);
          return { task_id: input.task_id, status: "cancelled" };
        },
      },
      finishTask: {
        handler: async (input) => {
          calls.push(["finishTask", input]);
          return { task_id: input.task_id, status: input.status };
        },
      },
      listTasks: {
        handler: async (input) => {
          calls.push(["listTasks", input]);
          const allTasks = taskStore.listTasks(input.limit);
          return { tasks: allTasks.map((t) => ({ task_id: t.task_id, status: t.status, summary: "summary", raw_log_path: "C:\\sensitive\\raw.log" })) };
        },
      },
      mergeTask: {
        handler: async (input) => {
          calls.push(["mergeTask", input]);
          return { task_id: input.task_id, action: input.action, status: "merged", repo_path: "C:\\sensitive\\repo" };
        },
      },
      tokenStatus: {
        handler: async (input) => {
          calls.push(["tokenStatus", input]);
          return input.reset ? { status: "reset" } : { status: "ok", used: { input_tokens: 0 } };
        },
      },
      pendingReviews: createPendingReviewsHandler(taskStore),
      agentList: createAgentListHandler(agentRegistry),
      deleteTask: createDeleteTaskHandler(taskStore),
    },
  };

  return { context, calls, taskId: task.task_id, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) };
}

test("admin API exposes fixed routes, augments safe task fields, and sanitizes local paths", async () => {
  const fixture = createContext();
  try {
    const tasks = await callApi(fixture.context, "GET", "/api/tasks?limit=5");
    assert.strictEqual(tasks.statusCode, 200);
    assert.strictEqual(tasks.body.ok, true);
    assert.strictEqual(tasks.body.data.tasks[0].objective, "admin api objective");
    assert.strictEqual(tasks.body.data.tasks[0].has_worktree, true);
    assert.strictEqual(JSON.stringify(tasks.body).includes("raw_log_path"), false);
    assert.strictEqual(JSON.stringify(tasks.body).includes("sensitive"), false);

    const detail = await callApi(fixture.context, "GET", "/api/tasks/" + fixture.taskId + "?detail_level=full&max_chars=20000");
    assert.strictEqual(detail.body.ok, true);
    assert.strictEqual(detail.body.data.has_worktree, true);
    assert.strictEqual(JSON.stringify(detail.body).includes("workspace_path"), false);
    assert.strictEqual(JSON.stringify(detail.body).includes("sensitive"), false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API health reports pending review count", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", "/api/health");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.pending_reviews.count, 1);
    assert.match(result.body.data.pending_reviews.command, /recover/);
    assert.ok(Array.isArray(result.body.data.agents.configured));
    assert.strictEqual(result.body.data.agents.endpoint, "/api/agents");
  } finally {
    fixture.cleanup();
  }
});

test("admin API exposes agent list without leaking command paths", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", "/api/agents");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    const mimo = result.body.data.agents.find((agent) => agent.id === "mimo");
    const reasonix = result.body.data.agents.find((agent) => agent.id === "reasonix-tui");
    assert.ok(mimo);
    assert.strictEqual(mimo.status, "ready");
    assert.ok(reasonix);
    assert.strictEqual(reasonix.status, "not_configured");
    assert.strictEqual(JSON.stringify(result.body).includes("mimoNodePath"), false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API exposes bounded pending reviews recovery inbox", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", "/api/pending-reviews?limit=5&max_chars=4000");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.pending_count, 1);
    assert.strictEqual(result.body.data.returned_count, 1);
    assert.strictEqual(result.body.data.tasks[0].task_id, fixture.taskId);
    assert.strictEqual(result.body.data.tasks[0].status, "review");
    assert.match(result.body.data.tasks[0].review_command, new RegExp(fixture.taskId));
    const serialized = JSON.stringify(result.body);
    assert.strictEqual(serialized.includes("raw_log_path"), false);
    assert.strictEqual(serialized.includes("stderr_log_path"), false);
    assert.strictEqual(serialized.includes("worktree_path"), false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API maps mutating routes to their dedicated handlers", async () => {
  const fixture = createContext();
  try {
    await callApi(fixture.context, "POST", "/api/tasks", {
      objective: "create",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
      use_worktree: false,
      priority: 5,
    });
    await callApi(fixture.context, "POST", "/api/tasks/" + fixture.taskId + "/replies", { message: "continue", priority: 4 });
    await callApi(fixture.context, "POST", "/api/tasks/" + fixture.taskId + "/cancel", {});
    await callApi(fixture.context, "POST", "/api/tasks/" + fixture.taskId + "/finish", { status: "accepted" });
    await callApi(fixture.context, "POST", "/api/tasks/" + fixture.taskId + "/worktree", { action: "merge" });
    await callApi(fixture.context, "POST", "/api/token-budget/reset", {});

    assert.deepStrictEqual(
      fixture.calls.map((call) => call[0]),
      ["startTask", "replyTask", "cancelTask", "finishTask", "mergeTask", "tokenStatus"]
    );
    assert.strictEqual(fixture.calls[1][1].message, "continue");
    assert.strictEqual(fixture.calls[3][1].status, "accepted");
    assert.strictEqual(fixture.calls[4][1].action, "merge");
    assert.strictEqual(fixture.calls[5][1].reset, true);
  } finally {
    fixture.cleanup();
  }
});

test("admin API maps POST /api/agent-tasks to agentStartTask", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", "/api/agent-tasks", {
      agent_id: "reasonix-tui",
      objective: "agent task",
      workspace_path: "C:\\workspace",
    });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    const captured = fixture.calls.find(([name]) => name === "agentStartTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].agent_id, "reasonix-tui");
  } finally {
    fixture.cleanup();
  }
});

test("admin API exposes agent task review details through generic route", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", `/api/agent-tasks/${fixture.taskId}?agent_id=reasonix-tui&detail_level=review`);
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.task_id, fixture.taskId);
    assert.strictEqual(result.body.data.agent, "reasonix-tui");
    assert.ok(result.body.data.review_package);
    assert.strictEqual(JSON.stringify(result.body).includes("agent_session_path"), false);
    assert.strictEqual(JSON.stringify(result.body).includes("workspace_path"), false);
    assert.strictEqual(JSON.stringify(result.body).includes("sensitive"), false);
    const captured = fixture.calls.find(([name]) => name === "agentGetTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].agent_id, "reasonix-tui");
  } finally {
    fixture.cleanup();
  }
});

test("admin API exposes low-token wait for generic agent tasks", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", `/api/agent-tasks/${fixture.taskId}/wait`, {
      agent_id: "reasonix-tui",
      timeout_seconds: 30,
      detail_level: "review",
      max_chars: 4000,
    });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.task_id, fixture.taskId);
    assert.strictEqual(result.body.data.agent, "reasonix-tui");
    assert.strictEqual(result.body.data.timed_out, false);
    assert.ok(result.body.data.review_package);
    assert.strictEqual(JSON.stringify(result.body).includes("agent_session_path"), false);
    const captured = fixture.calls.find(([name]) => name === "agentWaitTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].timeout_seconds, 30);
    assert.strictEqual(captured[1].agent_id, "reasonix-tui");
  } finally {
    fixture.cleanup();
  }
});

test("admin API maps agent task replies to agentReplyTask", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", `/api/agent-tasks/${fixture.taskId}/replies`, {
      agent_id: "reasonix-tui",
      message: "continue",
      priority: 4,
    });
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.task_id, fixture.taskId);
    assert.strictEqual(result.body.data.agent, "reasonix-tui");
    const captured = fixture.calls.find(([name]) => name === "agentReplyTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].message, "continue");
    assert.strictEqual(captured[1].priority, 4);
  } finally {
    fixture.cleanup();
  }
});

test("admin API permanently deletes a terminal task and its runtime artifacts", async () => {
  const fixture = createContext();
  try {
    const deletable = fixture.context.taskStore.createTask({
      objective: "old cancelled task",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    fixture.context.taskStore.updateTaskStatus(deletable.task_id, "cancelled");
    const artifactPaths = [
      fixture.context.taskStore.getBriefPath(deletable.task_id, 1),
      fixture.context.taskStore.getLogPath(deletable.task_id, 1),
      fixture.context.taskStore.getStderrLogPath(deletable.task_id, 1),
    ];
    for (const artifactPath of artifactPaths) {
      writeFileSync(artifactPath, "old task artifact", "utf-8");
    }

    const result = await callApi(fixture.context, "DELETE", "/api/tasks/" + deletable.task_id);

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.deepStrictEqual(result.body.data, { task_id: deletable.task_id, status: "deleted" });
    assert.strictEqual(fixture.context.taskStore.getTask(deletable.task_id), null);
    for (const artifactPath of artifactPaths) {
      assert.strictEqual(existsSync(artifactPath), false);
    }
  } finally {
    fixture.cleanup();
  }
});

test("admin API refuses to delete active tasks or tasks with a Worktree", async () => {
  const fixture = createContext();
  try {
    const active = fixture.context.taskStore.createTask({
      objective: "active task",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    fixture.context.taskStore.updateTaskStatus(active.task_id, "running");

    const activeResult = await callApi(fixture.context, "DELETE", "/api/tasks/" + active.task_id);
    assert.strictEqual(activeResult.statusCode, 400);
    assert.match(activeResult.body.error, /状态不允许删除/);
    assert.ok(fixture.context.taskStore.getTask(active.task_id));

    fixture.context.taskStore.updateTaskStatus(fixture.taskId, "cancelled");
    const worktreeResult = await callApi(fixture.context, "DELETE", "/api/tasks/" + fixture.taskId);
    assert.strictEqual(worktreeResult.statusCode, 400);
    assert.match(worktreeResult.body.error, /Worktree/);
    assert.ok(fixture.context.taskStore.getTask(fixture.taskId));
  } finally {
    fixture.cleanup();
  }
});

test("admin API rejects arbitrary routes and invalid task creation bodies", async () => {
  const fixture = createContext();
  try {
    const missing = await callApi(fixture.context, "POST", "/api/tools/mimo_start_task", {});
    assert.strictEqual(missing.statusCode, 404);
    assert.strictEqual(missing.body.ok, false);

    const invalid = await callApi(fixture.context, "POST", "/api/tasks", { objective: "" });
    assert.strictEqual(invalid.statusCode, 400);
    assert.strictEqual(invalid.body.ok, false);
    assert.match(invalid.body.error, /参数校验失败/);
  } finally {
    fixture.cleanup();
  }
});

test("admin API returns live task view with bounded events", async () => {
  const fixture = createContext();
  try {
    fixture.context.taskStore.updateTaskStatus(fixture.taskId, "running");
    const logPath = fixture.context.taskStore.getLogPath(fixture.taskId, 1);
    const { writeFileSync } = await import("node:fs");
    const events = [
      JSON.stringify({ type: "start", timestamp: Date.now(), summary: "task started" }),
      JSON.stringify({ type: "tool_use", timestamp: Date.now() + 1000, summary: "reading", tool: "file_read" }),
    ];
    writeFileSync(logPath, events.join("\n") + "\n", "utf-8");

    const result = await callApi(fixture.context, "GET", "/api/tasks/" + fixture.taskId + "/live");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.task_id, fixture.taskId);
    assert.strictEqual(result.body.data.is_live, true);
    assert.strictEqual(result.body.data.events.length, 2);
    assert.strictEqual(result.body.data.events[0].event_type, "start");
    assert.strictEqual(result.body.data.events[1].tool, "file_read");
    assert.strictEqual(typeof result.body.data.truncated, "boolean");
  } finally {
    fixture.cleanup();
  }
});

test("admin API live view respects max_events and max_chars bounds", async () => {
  const fixture = createContext();
  try {
    fixture.context.taskStore.updateTaskStatus(fixture.taskId, "running");
    const logPath = fixture.context.taskStore.getLogPath(fixture.taskId, 1);
    const { writeFileSync } = await import("node:fs");
    const events = [];
    for (let i = 0; i < 50; i++) {
      events.push(JSON.stringify({ type: "ev_" + i, timestamp: Date.now() + i * 1000, summary: "step " + i }));
    }
    writeFileSync(logPath, events.join("\n") + "\n", "utf-8");

    const bounded = await callApi(fixture.context, "GET", "/api/tasks/" + fixture.taskId + "/live?max_events=5&max_chars=2000");
    assert.strictEqual(bounded.statusCode, 200);
    assert.ok(bounded.body.data.events.length <= 5);
  } finally {
    fixture.cleanup();
  }
});

test("admin API live view returns 404 for nonexistent task", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", "/api/tasks/task_nonexistent/live");
    assert.strictEqual(result.statusCode, 404);
    assert.strictEqual(result.body.ok, false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API list includes safe-delete metadata for terminal task without worktree", async () => {
  const fixture = createContext();
  try {
    const deletable = fixture.context.taskStore.createTask({
      objective: "old cancelled task",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    fixture.context.taskStore.updateTaskStatus(deletable.task_id, "cancelled");

    const result = await callApi(fixture.context, "GET", "/api/tasks?limit=20");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);

    const task = result.body.data.tasks.find((t) => t.task_id === deletable.task_id);
    assert.ok(task, "expected to find the deletable task");
    assert.strictEqual(task.can_delete, true);
    assert.deepStrictEqual(task.delete_blockers, []);
    assert.strictEqual(task.delete_label, "可安全删除");
  } finally {
    fixture.cleanup();
  }
});

test("admin API list marks active task as not safe to delete", async () => {
  const fixture = createContext();
  try {
    const active = fixture.context.taskStore.createTask({
      objective: "running task",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    fixture.context.taskStore.updateTaskStatus(active.task_id, "running");

    const result = await callApi(fixture.context, "GET", "/api/tasks?limit=20");
    assert.strictEqual(result.statusCode, 200);

    const task = result.body.data.tasks.find((t) => t.task_id === active.task_id);
    assert.ok(task, "expected to find the active task");
    assert.strictEqual(task.can_delete, false);
    assert.ok(task.delete_blockers.includes("任务未结束"));
    assert.strictEqual(task.delete_label, "不可删除");
  } finally {
    fixture.cleanup();
  }
});

test("admin API list marks terminal task with worktree as not safe to delete", async () => {
  const fixture = createContext();
  try {
    fixture.context.taskStore.updateTaskStatus(fixture.taskId, "cancelled");

    const result = await callApi(fixture.context, "GET", "/api/tasks?limit=20");
    assert.strictEqual(result.statusCode, 200);

    const task = result.body.data.tasks.find((t) => t.task_id === fixture.taskId);
    assert.ok(task, "expected to find the fixture task");
    assert.strictEqual(task.status, "cancelled");
    assert.strictEqual(task.has_worktree, true);
    assert.strictEqual(task.can_delete, false);
    assert.ok(task.delete_blockers.includes("存在 Worktree"));
    assert.strictEqual(task.delete_label, "不可删除");
  } finally {
    fixture.cleanup();
  }
});

test("admin API detail includes safe-delete metadata", async () => {
  const fixture = createContext();
  try {
    const deletable = fixture.context.taskStore.createTask({
      objective: "accepted no worktree",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
    });
    fixture.context.taskStore.updateTaskStatus(deletable.task_id, "accepted");

    const result = await callApi(fixture.context, "GET", "/api/tasks/" + deletable.task_id + "?detail_level=review&max_chars=8000");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.data.can_delete, true);
    assert.deepStrictEqual(result.body.data.delete_blockers, []);
    assert.strictEqual(result.body.data.delete_label, "可安全删除");
  } finally {
    fixture.cleanup();
  }
});

test("admin API detail shows blockers for terminal task with worktree", async () => {
  const fixture = createContext();
  try {
    fixture.context.taskStore.updateTaskStatus(fixture.taskId, "cancelled");
    const result = await callApi(fixture.context, "GET", "/api/tasks/" + fixture.taskId + "?detail_level=review&max_chars=8000");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.data.can_delete, false);
    assert.ok(result.body.data.delete_blockers.includes("存在 Worktree"));
    assert.strictEqual(result.body.data.delete_label, "不可删除");
  } finally {
    fixture.cleanup();
  }
});

test("admin API accepts scope_mode, include_tests, and repo_wide_confirmed in POST /api/tasks", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", "/api/tasks", {
      objective: "scope test",
      workspace_path: "C:\\sensitive\\workspace",
      editable_paths: ["src"],
      scope_mode: "suggested",
      include_tests: "always",
      repo_wide_confirmed: false,
    });
    assert.strictEqual(result.statusCode, 200);
    const captured = fixture.calls.find(([name]) => name === "startTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].scope_mode, "suggested");
    assert.strictEqual(captured[1].include_tests, "always");
    assert.strictEqual(captured[1].repo_wide_confirmed, false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API defaults scope fields when not provided", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", "/api/tasks", {
      objective: "no scope fields",
      workspace_path: "C:\\sensitive\\workspace",
    });
    assert.strictEqual(result.statusCode, 200);
    const captured = fixture.calls.find(([name]) => name === "startTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].scope_mode, "strict");
    assert.strictEqual(captured[1].include_tests, "auto");
    assert.strictEqual(captured[1].repo_wide_confirmed, false);
  } finally {
    fixture.cleanup();
  }
});

test("admin API accepts origin_codex_thread_id, origin_codex_thread_url, and origin_source in POST /api/tasks", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "POST", "/api/tasks", {
      objective: "origin test",
      workspace_path: "C:\\sensitive\\workspace",
      origin_codex_thread_id: "thread-abc-123",
      origin_codex_thread_url: "codex://threads/thread-abc-123",
      origin_source: "codex",
    });
    assert.strictEqual(result.statusCode, 200);
    const captured = fixture.calls.find(([name]) => name === "startTask");
    assert.ok(captured);
    assert.strictEqual(captured[1].origin_codex_thread_id, "thread-abc-123");
    assert.strictEqual(captured[1].origin_codex_thread_url, "codex://threads/thread-abc-123");
    assert.strictEqual(captured[1].origin_source, "codex");
  } finally {
    fixture.cleanup();
  }
});

test("admin API returns origin fields as null when not provided in task creation", async () => {
  const fixture = createContext();
  try {
    const result = await callApi(fixture.context, "GET", "/api/tasks/" + fixture.taskId + "?detail_level=review&max_chars=8000");
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.data.origin_codex_thread_id, null);
    assert.strictEqual(result.body.data.origin_codex_thread_url, null);
    assert.strictEqual(result.body.data.origin_source, null);
  } finally {
    fixture.cleanup();
  }
});

test("admin API list includes origin fields for tasks with origin info", async () => {
  const fixture = createContext();
  try {
    const taskWithOrigin = fixture.context.taskStore.createTask({
      objective: "task with origin",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 1,
      runtime_timeout_seconds: 60,
      origin_codex_thread_id: "origin-thread-id",
      origin_codex_thread_url: "codex://threads/origin-thread-id",
      origin_source: "codex",
    });

    const result = await callApi(fixture.context, "GET", "/api/tasks?limit=20");
    assert.strictEqual(result.statusCode, 200);
    const task = result.body.data.tasks.find((t) => t.task_id === taskWithOrigin.task_id);
    assert.ok(task);
    assert.strictEqual(task.origin_codex_thread_id, "origin-thread-id");
    assert.strictEqual(task.origin_codex_thread_url, "codex://threads/origin-thread-id");
    assert.strictEqual(task.origin_source, "codex");
  } finally {
    fixture.cleanup();
  }
});
