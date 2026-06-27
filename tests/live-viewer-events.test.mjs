import { test } from "node:test";
import assert from "node:assert";

import { groupLiveEvents, liveToolGroupPreview } from "../apps/admin-ui/src/live-viewer-events.ts";

function event(kind, summary, extra = {}) {
  return {
    timestamp: "2026-06-27T00:00:00.000Z",
    event_type: kind === "tool" ? "tool_use" : kind,
    kind,
    summary,
    ...extra,
  };
}

test("groupLiveEvents folds consecutive tool calls between messages into one group", () => {
  const items = groupLiveEvents([
    event("message", "reply A"),
    event("tool", "read file", { tool: "read" }),
    event("tool", "run tests", { tool: "shell" }),
    event("tool", "write file", { tool: "write" }),
    event("message", "reply B"),
  ]);

  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[0].type, "event");
  assert.strictEqual(items[0].event.summary, "reply A");
  assert.strictEqual(items[1].type, "tool_group");
  assert.deepStrictEqual(items[1].events.map((entry) => entry.event.tool), ["read", "shell", "write"]);
  assert.strictEqual(items[2].type, "event");
  assert.strictEqual(items[2].event.summary, "reply B");
});

test("groupLiveEvents starts a new tool group after non-tool events", () => {
  const items = groupLiveEvents([
    event("tool", "first", { tool: "read" }),
    event("event", "system event"),
    event("tool", "second", { tool: "shell" }),
  ]);

  assert.strictEqual(items.length, 3);
  assert.strictEqual(items[0].type, "tool_group");
  assert.strictEqual(items[0].events.length, 1);
  assert.strictEqual(items[1].type, "event");
  assert.strictEqual(items[2].type, "tool_group");
  assert.strictEqual(items[2].events.length, 1);
});

test("liveToolGroupPreview summarizes unique tool names with a compact suffix", () => {
  const preview = liveToolGroupPreview([
    event("tool", "read", { tool: "read" }),
    event("tool", "read again", { tool: "read" }),
    event("tool", "shell", { tool: "shell" }),
    event("tool", "write", { tool: "write" }),
    event("tool", "search", { tool: "search" }),
    event("tool", "extra", { tool: "extra" }),
  ]);

  assert.strictEqual(preview, "read / shell / write / search 等");
});
