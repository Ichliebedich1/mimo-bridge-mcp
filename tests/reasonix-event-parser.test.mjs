import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractReasonixTokenUsageFromFile, parseReasonixSessionLine, parseReasonixSessionTail } from "../dist/services/reasonix-event-parser.js";

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "reasonix-events-"));
}

test("parseReasonixSessionLine exposes assistant content but not reasoning content", () => {
  const events = parseReasonixSessionLine(JSON.stringify({
    role: "assistant",
    content: "我已经完成修改，并运行了测试。",
    reasoning_content: "hidden reasoning should not be shown",
  }));

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "message");
  assert.strictEqual(events[0].event_type, "reasonix_assistant");
  assert.match(events[0].summary, /完成修改/);
  assert.strictEqual(JSON.stringify(events).includes("hidden reasoning"), false);
});

test("parseReasonixSessionLine summarizes tool calls without exposing full diff or absolute paths", () => {
  const events = parseReasonixSessionLine(JSON.stringify({
    role: "assistant",
    content: "",
    reasoning_content: "private",
    tool_calls: [
      {
        name: "edit",
        arguments: JSON.stringify({
          path: "C:\\Users\\test\\repo\\src\\secret.ts",
          oldString: "a".repeat(100),
          newString: "b".repeat(100),
        }),
        diff: "SECRET_DIFF_SHOULD_NOT_APPEAR\n".repeat(50),
        added: 3,
      },
    ],
  }));

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "tool");
  assert.strictEqual(events[0].tool, "edit");
  assert.match(events[0].summary, /secret\.ts/);
  assert.match(events[0].summary, /diff omitted/);
  assert.strictEqual(events[0].summary.includes("SECRET_DIFF_SHOULD_NOT_APPEAR"), false);
  assert.strictEqual(events[0].summary.includes("C:\\Users"), false);
});

test("parseReasonixSessionLine summarizes tool results with sanitization", () => {
  const events = parseReasonixSessionLine(JSON.stringify({
    role: "tool",
    name: "shell",
    content: "npm test passed\nC:\\Users\\secret\\file.txt\nsecret_token_abc123",
  }));

  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "tool");
  assert.strictEqual(events[0].status, "completed");
  assert.match(events[0].summary, /npm test passed/);
  assert.match(events[0].summary, /\[local path\]/);
  assert.strictEqual(JSON.stringify(events).includes("secret_token_abc123"), false);
});

test("parseReasonixSessionLine ignores user and system records", () => {
  assert.deepStrictEqual(parseReasonixSessionLine(JSON.stringify({ role: "user", content: "task brief" })), []);
  assert.deepStrictEqual(parseReasonixSessionLine(JSON.stringify({ role: "system", content: "system prompt" })), []);
});

test("parseReasonixSessionTail returns bounded newest session events", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "session.jsonl");
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ role: "assistant", content: "visible_" + String(i).padStart(2, "0") }));
    }
    writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");

    const result = parseReasonixSessionTail(filePath, 5, 8000);
    assert.strictEqual(result.events.length, 5);
    assert.strictEqual(result.events[0].summary, "visible_15");
    assert.strictEqual(result.events[4].summary, "visible_19");
    assert.strictEqual(result.truncated, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseReasonixSessionTail handles missing files gracefully", () => {
  assert.deepStrictEqual(parseReasonixSessionTail(join(tmpdir(), "missing-session.jsonl"), 10, 8000), {
    events: [],
    truncated: false,
  });
});

test("extractReasonixTokenUsageFromFile reads explicit usage fields only", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "usage.jsonl");
    writeFileSync(filePath, [
      JSON.stringify({
        role: "assistant",
        content: "done",
        usage: {
          prompt_tokens: 120,
          completion_tokens: 35,
          total_tokens: 155,
          cache_read_tokens: 9,
          cache_write_tokens: 4,
        },
        cost: 0.0042,
      }),
      JSON.stringify({
        role: "assistant",
        content: "next",
        tokens: {
          input: 10,
          output: 5,
          reasoning: 3,
          total: 18,
          cache: { read: 2, write: 1 },
        },
      }),
    ].join("\n") + "\n", "utf-8");

    const usage = extractReasonixTokenUsageFromFile(filePath);
    assert.strictEqual(usage.input_tokens, 130);
    assert.strictEqual(usage.output_tokens, 43);
    assert.strictEqual(usage.total_tokens, 173);
    assert.strictEqual(usage.estimated_cost, 0.0042);
    assert.strictEqual(usage.cache_read_tokens, 11);
    assert.strictEqual(usage.cache_write_tokens, 5);
    assert.strictEqual(usage.events_count, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extractReasonixTokenUsageFromFile does not invent token usage", () => {
  const dir = tmpDir();
  try {
    const filePath = join(dir, "no-usage.jsonl");
    writeFileSync(filePath, JSON.stringify({ role: "assistant", content: "no token fields here" }) + "\n", "utf-8");
    assert.deepStrictEqual(extractReasonixTokenUsageFromFile(filePath), {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost: null,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      events_count: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
