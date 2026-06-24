import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-stdio-protocol");

describe("STDIO MCP protocol", () => {
  let serverProcess;
  let messageId = 1;
  const pendingRequests = new Map();

  function sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      pendingRequests.set(id, { resolve, reject });
      serverProcess.stdin.write(request + "\n");

      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for response to ${method}`));
        }
      }, 5000);
    });
  }

  function processStdout(data) {
    const text = data.toString();
    const lines = text.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const response = JSON.parse(line);
        if (response.id !== undefined && pendingRequests.has(response.id)) {
          const { resolve } = pendingRequests.get(response.id);
          pendingRequests.delete(response.id);
          resolve(response);
        }
      } catch {
        // Ignore non-JSON lines
      }
    }
  }

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, "tasks"), { recursive: true });
    mkdirSync(join(testDir, "briefs"), { recursive: true });
    mkdirSync(join(testDir, "logs"), { recursive: true });

    const serverPath = join(__dirname, "..", "dist", "index.js");
    const nodePath = process.execPath;

    const env = {
      ...process.env,
      MIMO_NODE_PATH: nodePath,
      MIMO_ENTRY_PATH: join(__dirname, "fixtures", "fake-mimo.mjs"),
      MIMO_ALLOWED_ROOTS: testDir,
      MIMO_RUNTIME_DIR: testDir,
    };

    serverProcess = spawn(nodePath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    serverProcess.stdout.on("data", processStdout);

    serverProcess.stderr.on("data", (data) => {
      // Wait for server ready
    });

    await new Promise((r) => setTimeout(r, 2000));
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("tools/list should return all 25 tools", async () => {
    const result = await sendRequest("tools/list");

    assert.ok(result.result);
    assert.ok(result.result.tools);
    assert.strictEqual(result.result.tools.length, 25);

    const toolNames = result.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes("mimo_start_task"));
    assert.ok(toolNames.includes("mimo_get_task"));
    assert.ok(toolNames.includes("mimo_wait_task"));
    assert.ok(toolNames.includes("mimo_reply_task"));
    assert.ok(toolNames.includes("mimo_cancel_task"));
    assert.ok(toolNames.includes("mimo_finish_task"));
    assert.ok(toolNames.includes("mimo_list_tasks"));
    assert.ok(toolNames.includes("mimo_pending_reviews"));
    assert.ok(toolNames.includes("mimo_merge_task"));
    assert.ok(toolNames.includes("agent_list"));
    assert.ok(toolNames.includes("agent_start_task"));
    assert.ok(toolNames.includes("agent_reply_task"));
    assert.ok(toolNames.includes("agent_get_task"));
    assert.ok(toolNames.includes("agent_wait_task"));
    assert.ok(toolNames.includes("agent_list_tasks"));
    assert.ok(toolNames.includes("agent_pending_reviews"));
    assert.ok(toolNames.includes("agent_cancel_task"));
    assert.ok(toolNames.includes("agent_finish_task"));
    assert.ok(toolNames.includes("agent_merge_task"));
    assert.ok(toolNames.includes("agent_delete_task"));
    assert.ok(toolNames.includes("agent_queue_status"));
    assert.ok(toolNames.includes("agent_token_status"));
    assert.ok(toolNames.includes("mimo_queue_status"));
    assert.ok(toolNames.includes("mimo_token_status"));
    assert.ok(toolNames.includes("mimo_delete_task"));
  });

  it("mimo_list_tasks should return empty list initially", async () => {
    const result = await sendRequest("tools/call", {
      name: "mimo_list_tasks",
      arguments: {},
    });

    assert.ok(result.result);
    const text = result.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(Array.isArray(parsed.tasks));
  });

  it("agent_list should return MiMo as a configured agent", async () => {
    const result = await sendRequest("tools/call", {
      name: "agent_list",
      arguments: {},
    });

    assert.ok(result.result);
    const text = result.result.content[0].text;
    const parsed = JSON.parse(text);
    const mimo = parsed.agents.find((agent) => agent.id === "mimo");
    assert.ok(mimo);
    assert.strictEqual(mimo.kind, "mimo");
    assert.strictEqual(mimo.status, "ready");
  });

  it("mimo_get_task should return error for nonexistent task", async () => {
    const result = await sendRequest("tools/call", {
      name: "mimo_get_task",
      arguments: { task_id: "task_nonexistent" },
    });

    assert.ok(result.result);
    const text = result.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.ok(parsed.error);
  });

  it("mimo_merge_task should route calls to the merge handler", async () => {
    const result = await sendRequest("tools/call", {
      name: "mimo_merge_task",
      arguments: { task_id: "task_000000000000", action: "merge" },
    });

    assert.ok(result.result);
    const text = result.result.content[0].text;
    const parsed = JSON.parse(text);
    assert.match(parsed.error, /任务不存在/);
  });

  it("mimo_cancel_task should cancel a running task", async () => {
    const result1 = await sendRequest("tools/call", {
      name: "mimo_start_task",
      arguments: {
        objective: "STDIO 协议取消测试",
        workspace_path: testDir,
        runtime_timeout_seconds: 60,
      },
    });

    assert.ok(result1.result);
    const text1 = result1.result.content[0].text;
    const parsed1 = JSON.parse(text1);
    assert.ok(parsed1.task_id);
    assert.strictEqual(parsed1.status, "running");

    const taskId = parsed1.task_id;

    const reviewResult = await sendRequest("tools/call", {
      name: "mimo_get_task",
      arguments: { task_id: taskId },
    });
    const reviewText = reviewResult.result.content[0].text;
    const reviewParsed = JSON.parse(reviewText);
    assert.strictEqual(reviewParsed.detail_level, "review");
    assert.ok(reviewParsed.review_package);
    assert.strictEqual("diff" in reviewParsed, false);
    assert.strictEqual("raw_log_path" in reviewParsed, false);
    assert.strictEqual("stderr_log_path" in reviewParsed, false);

    const result2 = await sendRequest("tools/call", {
      name: "mimo_cancel_task",
      arguments: { task_id: taskId },
    });

    const text2 = result2.result.content[0].text;
    const parsed2 = JSON.parse(text2);
    assert.strictEqual(parsed2.status, "cancelled");
    assert.strictEqual(parsed2.task_id, taskId);
  });
});
