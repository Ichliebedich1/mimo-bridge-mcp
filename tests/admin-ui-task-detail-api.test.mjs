import { test } from "node:test";
import assert from "node:assert";

import { fetchFocusedTask, fetchFullTask, fetchTask, fetchTaskDiff, fetchTaskLogs } from "../apps/admin-ui/src/api.ts";

function reviewResponse(taskId, agent = "reasonix-tui") {
  return {
    task_id: taskId,
    agent,
    status: "review",
    current_round: 1,
    has_worktree: true,
    can_delete: false,
    delete_blockers: ["has_worktree"],
    review_package: {
      task_id: taskId,
      status: "review",
      objective: "review route test",
      changed_files: ["src/file.ts"],
      changed_files_count: 1,
      diff_stat: "1 file changed",
      changed_lines_summary: [{ path: "src/file.ts", additions: 1, deletions: 0 }],
      out_of_bounds_report: { has_changes: false, files: [] },
      test_result: "passed",
      exit_code: 0,
      agent_summary: "done",
      mimo_summary: "done",
      risk_flags: [],
      review_recommendation: "accept",
      truncated: false,
    },
  };
}

function installFetchMock(responseFactory = (path) => reviewResponse("task_1", path.includes("agent-tasks") ? "reasonix-tui" : "mimo")) {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    calls.push({
      path: String(path),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(String(options.body)) : null,
    });
    return new Response(JSON.stringify({ ok: true, data: responseFactory(String(path)) }), {
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

test("admin UI task detail reads use generic agent route for Reasonix tasks", async () => {
  const mock = installFetchMock();
  try {
    await fetchTask("task_1", "reasonix-tui");
    await fetchFocusedTask("task_1", "src/file.ts", "reasonix-tui");
    await fetchTaskDiff("task_1", "src/file.ts", "reasonix-tui");
    await fetchTaskLogs("task_1", 20, "reasonix-tui");
    await fetchFullTask("task_1", "reasonix-tui");

    assert.deepStrictEqual(
      mock.calls.map((call) => call.path),
      [
        "/api/agent-tasks/task_1?detail_level=review&max_chars=8000&agent_id=reasonix-tui",
        "/api/agent-tasks/task_1?detail_level=focused&max_chars=20000&diff_paths=src%2Ffile.ts&agent_id=reasonix-tui",
        "/api/agent-tasks/task_1?detail_level=diff&max_chars=20000&diff_paths=src%2Ffile.ts&agent_id=reasonix-tui",
        "/api/agent-tasks/task_1?detail_level=logs&log_tail_lines=20&max_chars=8000&agent_id=reasonix-tui",
        "/api/agent-tasks/task_1?detail_level=full&max_chars=20000&log_tail_lines=50&agent_id=reasonix-tui",
      ]
    );
  } finally {
    mock.restore();
  }
});

test("admin UI task detail reads keep MiMo tasks on legacy route", async () => {
  const mock = installFetchMock();
  try {
    await fetchTask("task_1", "mimo");
    await fetchFocusedTask("task_1", "src/file.ts", "mimo");
    await fetchTaskDiff("task_1", "src/file.ts", "mimo");
    await fetchTaskLogs("task_1", 20, "mimo");
    await fetchFullTask("task_1", "mimo");

    assert.deepStrictEqual(
      mock.calls.map((call) => call.path),
      [
        "/api/tasks/task_1?detail_level=review&max_chars=8000",
        "/api/tasks/task_1?detail_level=focused&max_chars=20000&diff_paths=src%2Ffile.ts",
        "/api/tasks/task_1?detail_level=diff&max_chars=20000&diff_paths=src%2Ffile.ts",
        "/api/tasks/task_1?detail_level=logs&log_tail_lines=20&max_chars=8000",
        "/api/tasks/task_1?detail_level=full&max_chars=20000&log_tail_lines=50",
      ]
    );
  } finally {
    mock.restore();
  }
});
