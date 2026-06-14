import { describe, it } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("fake-mimo", () => {
  it("should output valid JSONL events", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(nodePath, [fakeMimoPath, "run", "--format", "json", "测试消息"], {
        shell: false,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 0);

    const lines = result.stdout.trim().split("\n");
    assert.ok(lines.length >= 3, "应该至少有 3 行 JSON 事件");

    for (const line of lines) {
      const event = JSON.parse(line);
      assert.ok(event.type, "事件应该有 type 字段");
      assert.ok(event.sessionID, "事件应该有 sessionID 字段");
    }

    const sessionEvent = lines.find((line) => {
      const event = JSON.parse(line);
      return event.sessionID;
    });
    assert.ok(sessionEvent, "应该包含 sessionID 的事件");
  });

  it("should handle --session parameter for continuation", async () => {
    const fakeMimoPath = join(__dirname, "fixtures", "fake-mimo.mjs");
    const nodePath = process.execPath;

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(
        nodePath,
        [fakeMimoPath, "run", "--session", "ses_test123", "--format", "json", "继续消息"],
        { shell: false }
      );

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on("error", reject);
    });

    assert.strictEqual(result.code, 0);

    const lines = result.stdout.trim().split("\n");
    const textEvent = JSON.parse(lines.find((line) => JSON.parse(line).type === "text"));
    assert.ok(textEvent.part.text.includes("收到回复"), "续接任务应该返回续接回复");
  });
});
