import { test } from "node:test";
import assert from "node:assert";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseJsonlLine, parseJsonlTail, readLiveTaskView, parseLiveParams } from "../apps/local-daemon/dist/apps/local-daemon/src/live-task-view.js";
import { TaskStore } from "../dist/services/task-store.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "live-view-"));
}

test("parseJsonlLine extracts timestamp, event_type, and summary from valid JSON", () => {
  const line = JSON.stringify({ type: "tool_use", timestamp: 1700000000000, part: { text: "reading file" } });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.event_type, "tool_use");
  assert.strictEqual(event.summary, "reading file");
  assert.ok(event.timestamp.includes("2023"));
});

test("parseJsonlLine returns null for malformed JSON", () => {
  assert.strictEqual(parseJsonlLine("not json"), null);
  assert.strictEqual(parseJsonlLine("{broken"), null);
  assert.strictEqual(parseJsonlLine(""), null);
});

test("parseJsonlLine sanitizes event_type to safe characters", () => {
  const line = JSON.stringify({ type: "tool<script>", timestamp: Date.now() });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.event_type, "tool_script_");
  assert.ok(event.event_type.length <= 64);
});

test("parseJsonlLine sanitizes summaries containing local filesystem paths", () => {
  const winPath = JSON.stringify({ type: "info", timestamp: Date.now(), summary: "reading C:\\Users\\secret\\file.txt" });
  const unixPath = JSON.stringify({ type: "info", timestamp: Date.now(), summary: "reading /home/user/secret" });
  assert.ok(parseJsonlLine(winPath).summary.includes("[local path]"));
  assert.ok(parseJsonlLine(unixPath).summary.includes("[local path]"));
});

test("parseJsonlLine sanitizes summaries containing session/stdin references", () => {
  const stdin = JSON.stringify({ type: "info", timestamp: Date.now(), summary: "sending to stdin" });
  const sessionId = JSON.stringify({ type: "info", timestamp: Date.now(), summary: "session_id changed" });
  assert.match(parseJsonlLine(stdin).summary, /\[stdin\]|已过滤/);
  assert.ok(parseJsonlLine(sessionId).summary.includes("[session]"));
});

test("parseJsonlLine truncates long summaries to 1000 chars", () => {
  const longText = "x".repeat(500);
  const line = JSON.stringify({ type: "info", timestamp: Date.now(), summary: longText });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.summary, longText);
});

test("parseJsonlLine parses MiMo event structure: part.tool, part.state.status, part.state.title", () => {
  const line = JSON.stringify({
    type: "tool_event",
    timestamp: 1700000000000,
    part: {
      tool: "read_file",
      state: {
        status: "completed",
        title: "Reading config.json",
        input: { description: "Reading the config file" },
        output: "SECRET_OUTPUT_SHOULD_NOT_APPEAR",
      },
    },
  });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.tool, "read_file");
  assert.strictEqual(event.status, "completed");
  assert.strictEqual(event.summary, "Reading config.json");
  assert.ok(!event.summary.includes("SECRET_OUTPUT"));
});

test("parseJsonlLine uses part.state.input.description when title is absent", () => {
  const line = JSON.stringify({
    type: "tool_event",
    timestamp: 1700000000000,
    part: {
      tool: "write_file",
      state: {
        status: "running",
        input: { description: "Writing the output file" },
        output: "SHOULD_NOT_APPEAR",
      },
    },
  });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.summary, "Writing the output file");
  assert.strictEqual(event.tool, "write_file");
  assert.strictEqual(event.status, "running");
});

test("parseJsonlLine prefers explicit summary over part.state.output", () => {
  const withOutput = JSON.stringify({
    type: "cmd",
    timestamp: Date.now(),
    summary: "safe summary",
    part: {
      tool: "bash",
      state: {
        status: "done",
        output: "C:\\Users\\secret\\password.txt\nsecret_token_123",
        input: { command: "rm -rf /", arguments: ["--force"] },
      },
    },
  });
  const event = parseJsonlLine(withOutput);
  assert.ok(event);
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("secret_token_123"));
  assert.ok(!serialized.includes("rm -rf"));
  assert.ok(!serialized.includes("--force"));
  assert.strictEqual(event.summary, "safe summary");
});

test("parseJsonlLine exposes visible tool output with sanitization", () => {
  const line = JSON.stringify({
    type: "tool_use",
    timestamp: Date.now(),
    part: {
      tool: "bash",
      state: {
        status: "completed",
        output: "npm test passed\nC:\\Users\\secret\\file.txt\nsecret_token_abc123",
      },
    },
  });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.tool, "bash");
  assert.ok(event.summary.includes("npm test passed"));
  assert.ok(event.summary.includes("[local path]"));
  assert.ok(!JSON.stringify(event).includes("secret_token_abc123"));
});

test("parseJsonlLine summarizes file-read tool calls without dumping file content", () => {
  const event = parseJsonlLine(JSON.stringify({
    type: "tool_use",
    timestamp: Date.now(),
    part: {
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "C:\\Users\\test\\project\\src\\secret.ts" },
        output: "<path>C:\\Users\\test\\project\\src\\secret.ts</path>\n<content>\nSECRET_SOURCE_SHOULD_NOT_APPEAR\n</content>",
      },
    },
  }));
  assert.ok(event);
  assert.strictEqual(event.kind, "tool");
  assert.strictEqual(event.tool, "read");
  assert.ok(event.summary.includes("secret.ts"));
  assert.ok(event.summary.includes("file content omitted"));
  assert.ok(!event.summary.includes("SECRET_SOURCE_SHOULD_NOT_APPEAR"));
});

test("parseJsonlLine keeps multiline visible MiMo text", () => {
  const text = "第一行：我正在检查文件。\n第二行：我会运行测试。";
  const event = parseJsonlLine(JSON.stringify({
    type: "text",
    timestamp: Date.now(),
    part: { type: "text", text },
  }));
  assert.ok(event);
  assert.strictEqual(event.summary, text);
});

test("parseJsonlLine sanitizes and length-limits tool and status fields", () => {
  const line = JSON.stringify({
    type: "ev",
    timestamp: Date.now(),
    part: {
      tool: "a".repeat(200) + "<script>alert(1)</script>",
      state: { status: "b".repeat(100) + "'; DROP TABLE--" },
    },
  });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.ok(event.tool.length <= 48);
  assert.ok(event.status.length <= 32);
  assert.ok(!event.tool.includes("<"));
  assert.ok(!event.status.includes("'"));
});

test("parseJsonlLine extracts tool from top-level tool field as fallback", () => {
  const line = JSON.stringify({ type: "call", timestamp: Date.now(), tool: "file_read", status: "ok" });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.tool, "file_read");
  assert.strictEqual(event.status, "ok");
});

test("parseJsonlLine uses fallback summary when no text/message/summary/title found", () => {
  const line = JSON.stringify({ type: "heartbeat", timestamp: Date.now() });
  const event = parseJsonlLine(line);
  assert.ok(event);
  assert.strictEqual(event.summary, "[heartbeat]");
});

test("parseJsonlTail returns bounded newest events from a JSONL file", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "test.jsonl");
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ type: "event_" + i, timestamp: Date.now() + i * 1000, summary: "step " + i }));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

    const result = parseJsonlTail(filePath, 5, 8000);
    assert.strictEqual(result.events.length, 5);
    assert.strictEqual(result.events[0].summary, "step 15");
    assert.strictEqual(result.events[4].summary, "step 19");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseJsonlTail retains newest events under tight char budget", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "tight.jsonl");
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ type: "ev", timestamp: Date.now() + i * 1000, summary: "event_" + String(i).padStart(3, "0") + "_" + "x".repeat(100) }));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

    const result = parseJsonlTail(filePath, 20, 600);
    assert.ok(result.events.length < 20);
    assert.strictEqual(result.truncated, true);
    const lastOriginal = "event_019_" + "x".repeat(100);
    assert.strictEqual(result.events[result.events.length - 1].summary, lastOriginal);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseJsonlTail reads backward and returns only bounded tail from large file", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "large.jsonl");
    const lines = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(JSON.stringify({ type: "ev", timestamp: Date.now() + i * 1000, summary: "line_" + i }));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

    const result = parseJsonlTail(filePath, 10, 8000);
    assert.strictEqual(result.events.length, 10);
    assert.strictEqual(result.events[0].summary, "line_4990");
    assert.strictEqual(result.events[9].summary, "line_4999");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseJsonlTail extracts MiMo text from raw PTY output and redacts stdin without filtering the message", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "pty.jsonl");
    const textEvent = {
      type: "text",
      timestamp: 1700000001000,
      sessionID: "ses_test",
      part: {
        type: "text",
        text: "PowerShell wrapper forwards stdin safely.\n完成报告：测试通过。",
      },
    };
    const content =
      "\u001b[2J\u001b[H" +
      JSON.stringify({ type: "step_start", timestamp: 1700000000000, part: { type: "step-start" } }) +
      JSON.stringify(textEvent) +
      JSON.stringify({ type: "step_finish", timestamp: 1700000002000, part: { type: "step-finish", reason: "stop" } });
    writeFileSync(filePath, content, "utf-8");

    const result = parseJsonlTail(filePath, 10, 8000);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].kind, "message");
    assert.ok(result.events[0].summary.includes("[stdin]"));
    assert.ok(result.events[0].summary.includes("完成报告"));
    assert.ok(!result.events[0].summary.includes("content filtered"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseJsonlTail marks truncated when file exceeds byte cap", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "huge.jsonl");
    const lines = [];
    for (let i = 0; i < 10000; i++) {
      lines.push(JSON.stringify({ type: "ev", timestamp: Date.now() + i * 1000, summary: "x".repeat(80) }));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

    const result = parseJsonlTail(filePath, 10, 8000);
    assert.ok(result.events.length > 0);
    assert.strictEqual(result.truncated, true);
    const last = result.events[result.events.length - 1];
    assert.ok(last.summary.includes("x"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseJsonlTail handles missing file gracefully", () => {
  const result = parseJsonlTail("/nonexistent/path.jsonl", 10, 8000);
  assert.deepStrictEqual(result, { events: [], truncated: false });
});

test("parseJsonlTail skips malformed lines and processes valid ones", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "mixed.jsonl");
    const content = [
      '{"type":"good","timestamp":1700000000000,"summary":"first"}',
      "not json at all",
      '{"type":"good","timestamp":1700000001000,"summary":"second"}',
      "",
      '{"broken"',
    ].join("\n");
    writeFileSync(filePath, content, "utf-8");

    const result = parseJsonlTail(filePath, 10, 8000);
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.events[0].summary, "first");
    assert.strictEqual(result.events[1].summary, "second");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLiveTaskView returns empty events when log file does not exist", () => {
  const dir = tmpDir();
  try {
    const taskStore = new TaskStore(dir);
    const task = taskStore.createTask({
      objective: "test",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });

    const result = readLiveTaskView(taskStore, task.task_id, 40, 8000);
    assert.ok(!("error" in result));
    assert.strictEqual(result.events.length, 0);
    assert.strictEqual(result.is_live, false);
    assert.strictEqual(result.truncated, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLiveTaskView returns error for nonexistent task", () => {
  const dir = tmpDir();
  try {
    const taskStore = new TaskStore(dir);
    const result = readLiveTaskView(taskStore, "task_nonexistent", 40, 8000);
    assert.ok("error" in result);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLiveTaskView sets is_live true when task status is running", () => {
  const dir = tmpDir();
  try {
    const taskStore = new TaskStore(dir);
    const task = taskStore.createTask({
      objective: "test",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    taskStore.updateTaskStatus(task.task_id, "running");

    const result = readLiveTaskView(taskStore, task.task_id, 40, 8000);
    assert.ok(!("error" in result));
    assert.strictEqual(result.is_live, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLiveTaskView reads events from existing log file", () => {
  const dir = tmpDir();
  try {
    const taskStore = new TaskStore(dir);
    const task = taskStore.createTask({
      objective: "test",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    taskStore.updateTaskStatus(task.task_id, "running");

    const logPath = taskStore.getLogPath(task.task_id, task.current_round);
    const events = [
      JSON.stringify({ type: "start", timestamp: Date.now(), summary: "task started" }),
      JSON.stringify({ type: "tool_use", timestamp: Date.now() + 1000, summary: "reading files", tool: "file_read" }),
    ];
    writeFileSync(logPath, events.join("\n") + "\n", "utf-8");

    const result = readLiveTaskView(taskStore, task.task_id, 40, 8000);
    assert.ok(!("error" in result));
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.events[0].event_type, "start");
    assert.strictEqual(result.events[1].tool, "file_read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLiveTaskView uses the latest completed log round after current_round advances", () => {
  const dir = tmpDir();
  try {
    const taskStore = new TaskStore(dir);
    const task = taskStore.createTask({
      objective: "completed round",
      workspace_path: "C:\\workspace",
      editable_paths: [],
      readonly_paths: [],
      acceptance_criteria: [],
      max_rounds: 5,
      runtime_timeout_seconds: 900,
    });
    writeFileSync(
      taskStore.getLogPath(task.task_id, 1),
      JSON.stringify({ type: "text", timestamp: Date.now(), summary: "round one complete" }) + "\n",
      "utf-8",
    );
    taskStore.updateTaskSession(task.task_id, "ses_completed");
    taskStore.updateTaskStatus(task.task_id, "review");

    const result = readLiveTaskView(taskStore, task.task_id, 40, 8000);
    assert.ok(!("error" in result));
    assert.strictEqual(result.current_round, 1);
    assert.strictEqual(result.events.length, 1);
    assert.strictEqual(result.events[0].summary, "round one complete");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseLiveParams returns defaults for missing or invalid values", () => {
  const empty = new URLSearchParams();
  assert.deepStrictEqual(parseLiveParams(empty), { max_events: 40, max_chars: 8000 });

  const invalid = new URLSearchParams({ max_events: "abc", max_chars: "xyz" });
  assert.deepStrictEqual(parseLiveParams(invalid), { max_events: 40, max_chars: 8000 });

  const overMax = new URLSearchParams({ max_events: "999", max_chars: "999999" });
  assert.deepStrictEqual(parseLiveParams(overMax), { max_events: 40, max_chars: 8000 });

  const valid = new URLSearchParams({ max_events: "10", max_chars: "5000" });
  assert.deepStrictEqual(parseLiveParams(valid), { max_events: 10, max_chars: 5000 });

  const clamped = new URLSearchParams({ max_events: "1", max_chars: "1000" });
  assert.deepStrictEqual(parseLiveParams(clamped), { max_events: 1, max_chars: 1000 });
});
