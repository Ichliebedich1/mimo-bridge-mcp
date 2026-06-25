import { test } from "node:test";
import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { persistTaskAttachments, taskHasImageAttachment } from "../dist/services/task-attachments.js";

test("persistTaskAttachments writes sanitized files under task attachment directory", () => {
  const runtime = mkdtempSync(join(tmpdir(), "task-attachments-"));
  try {
    const result = persistTaskAttachments(runtime, "task_abcdef123456", [
      {
        name: "../截图.png",
        mime_type: "image/png",
        size_bytes: 5,
        base64: Buffer.from("hello").toString("base64"),
      },
    ]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.attachments.length, 1);
    assert.strictEqual(result.attachments[0].kind, "image");
    assert.ok(result.attachments[0].path.includes(join("attachments", "task_abcdef123456")));
    assert.ok(existsSync(result.attachments[0].path));
    assert.strictEqual(readFileSync(result.attachments[0].path, "utf-8"), "hello");
    assert.strictEqual(result.attachments[0].name.includes(".."), false);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("persistTaskAttachments rejects invalid base64 and size mismatch", () => {
  const runtime = mkdtempSync(join(tmpdir(), "task-attachments-invalid-"));
  try {
    const invalid = persistTaskAttachments(runtime, "task_abcdef123456", [
      { name: "bad.bin", base64: "not base64!?" },
    ]);
    assert.strictEqual(invalid.ok, false);

    const mismatch = persistTaskAttachments(runtime, "task_abcdef123456", [
      { name: "bad.txt", size_bytes: 999, base64: Buffer.from("hello").toString("base64") },
    ]);
    assert.strictEqual(mismatch.ok, false);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});

test("taskHasImageAttachment detects image payloads", () => {
  assert.strictEqual(taskHasImageAttachment([{ name: "a.png", mime_type: "image/png", base64: "a" }]), true);
  assert.strictEqual(taskHasImageAttachment([{ name: "a.txt", mime_type: "text/plain", base64: "a" }]), false);
});
