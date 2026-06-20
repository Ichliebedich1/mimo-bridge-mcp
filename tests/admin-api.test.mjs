import { test } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleAdminApi } from "../apps/local-daemon/dist/apps/local-daemon/src/admin-api.js";
import { TaskStore } from "../dist/services/task-store.js";
import { createDeleteTaskHandler } from "../dist/tools/delete-task.js";

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
      mcpConfig: {},
      configError: null,
      mimoVersion: { nodeVersion: "test", cliVersion: "test" },
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
          return { tasks: [{ task_id: task.task_id, status: "review", summary: "summary", raw_log_path: "C:\\sensitive\\raw.log" }] };
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
