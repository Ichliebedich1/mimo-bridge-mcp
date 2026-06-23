import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { run, sdkRequestTimeoutMs } from "../scripts/mimo-bridge-client.mjs";

const CLIENT_PATH = join(import.meta.dirname, "..", "scripts", "mimo-bridge-client.mjs");
const PS_WRAPPER_PATH = join(import.meta.dirname, "..", "scripts", "mimo-bridge-client.ps1");

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runClient(args, { stdin, env = {}, timeout = 10_000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLIENT_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data;
    });
    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    if (stdin !== undefined) {
      proc.stdin.end(stdin);
    } else {
      proc.stdin.end();
    }

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function stdinFromText(text) {
  return Readable.from([Buffer.from(text, "utf8")]);
}

test("health command reports ok when daemon is healthy", async () => {
  const mock = await startMockServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { daemon: { status: "ok" } } }));
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const result = await runClient(["health"], { env: { MIMO_BRIDGE_URL: mock.baseUrl } });
    assert.equal(result.code, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.operation, "health");
    assert.equal(out.status, "ok");
  } finally {
    await closeServer(mock.server);
  }
});

test("health command fails with an actionable error when daemon is unreachable", async () => {
  const result = await runClient(["health"], { env: { MIMO_BRIDGE_URL: "http://127.0.0.1:1" } });
  assert.equal(result.code, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.operation, "health");
  assert.match(out.error, /Cannot connect|did not respond/);
});

test("start command posts task through stdin JSON and defaults workspace_path", async () => {
  let receivedBody = null;
  const mock = await startMockServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/tasks") {
      const chunks = [];
      req.on("data", (data) => chunks.push(data));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { task_id: "task_abc", status: "running" } }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const result = await runClient(["start"], {
      stdin: JSON.stringify({ objective: "test objective" }),
      env: { MIMO_BRIDGE_URL: mock.baseUrl },
    });
    assert.equal(result.code, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.operation, "start");
    assert.equal(out.task_id, "task_abc");
    assert.equal(receivedBody.objective, "test objective");
    assert.equal(receivedBody.workspace_path, process.cwd());
  } finally {
    await closeServer(mock.server);
  }
});

test("start command reads UTF-8 JSON file with Chinese path text", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "mimo-client-"));
  const jsonFile = join(tmpDir, "task.json");
  const workspacePath = "C:\\工作区\\项目";
  const objective = "中文目标";
  writeFileSync(jsonFile, JSON.stringify({ objective, workspace_path: workspacePath }), "utf8");

  let receivedBody = null;
  const mock = await startMockServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/tasks") {
      const chunks = [];
      req.on("data", (data) => chunks.push(data));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { task_id: "task_cn", status: "running" } }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const result = await runClient(["start", "--json", jsonFile], { env: { MIMO_BRIDGE_URL: mock.baseUrl } });
    assert.equal(result.code, 0);
    assert.equal(receivedBody.objective, objective);
    assert.equal(receivedBody.workspace_path, workspacePath);
  } finally {
    await closeServer(mock.server);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("start command preserves special characters from JSON", async () => {
  let receivedBody = null;
  const mock = await startMockServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/tasks") {
      const chunks = [];
      req.on("data", (data) => chunks.push(data));
      req.on("end", () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { task_id: "task_special", status: "running" } }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const objective = 'a <b> "quoted" C:\\path\\file\nnext line';
    const result = await runClient(["start"], {
      stdin: JSON.stringify({ objective }),
      env: { MIMO_BRIDGE_URL: mock.baseUrl },
    });
    assert.equal(result.code, 0);
    assert.equal(receivedBody.objective, objective);
  } finally {
    await closeServer(mock.server);
  }
});

test("start command rejects missing objective with structured JSON", async () => {
  const result = await runClient(["start"], { stdin: JSON.stringify({}) });
  assert.equal(result.code, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.operation, "start");
  assert.match(out.error, /objective/);
});

test("review command fetches bounded review mode by default", async () => {
  const mock = await startMockServer((req, res) => {
    if (req.url.startsWith("/api/tasks/task_rev")) {
      const url = new URL(req.url, "http://localhost");
      assert.equal(url.searchParams.get("detail_level"), "review");
      assert.equal(url.searchParams.get("max_chars"), "8000");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        data: {
          task_id: "task_rev",
          detail_level: "review",
          status: "review",
          review_package: { objective: "done", mimo_summary: "completed" },
        },
      }));
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const result = await runClient(["review", "--task-id", "task_rev"], { env: { MIMO_BRIDGE_URL: mock.baseUrl } });
    assert.equal(result.code, 0);
    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.operation, "review");
    assert.equal(out.task_id, "task_rev");
    assert.equal(out.status, "review");
    assert.equal(out.detail_level, "review");
    const serialized = JSON.stringify(out);
    assert.equal(serialized.includes("raw_log_path"), false);
    assert.equal(serialized.includes("stderr_log_path"), false);
    assert.equal(serialized.includes("worktree_path"), false);
  } finally {
    await closeServer(mock.server);
  }
});

test("review command rejects missing task id", async () => {
  const result = await runClient(["review"]);
  assert.equal(result.code, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.operation, "review");
  assert.match(out.error, /task-id/);
});

test("wait command uses SDK request timeout greater than timeout_seconds", () => {
  assert.equal(sdkRequestTimeoutMs(1), 61_000);
  assert.equal(sdkRequestTimeoutMs(1800), 1_860_000);
  assert.ok(sdkRequestTimeoutMs(3600) > 3_600_000);
});

test("wait command can use injected waiter and returns bounded review package", async () => {
  const result = await run(["wait", "--task-id", "task_wait", "--timeout-seconds", "30"], {
    waitForTask: async ({ taskId, timeoutSeconds, operation }) => ({
      exitCode: 0,
      body: {
        ok: true,
        operation,
        task_id: taskId,
        status: "review",
        timed_out: false,
        waited_ms: 5,
        review_package: {
          task_id: taskId,
          status: "review",
          objective: "done",
        },
        observed_timeout_seconds: timeoutSeconds,
      },
    }),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.operation, "wait");
  assert.equal(result.body.task_id, "task_wait");
  assert.equal(result.body.status, "review");
  assert.equal(result.body.review_package.objective, "done");
});

test("start-and-wait returns as soon as injected waiter reports completion", async () => {
  const mock = await startMockServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/tasks") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data: { task_id: "task_done", status: "running" } }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });

  try {
    const result = await run(["start-and-wait", "--timeout-seconds", "1800"], {
      env: { MIMO_BRIDGE_URL: mock.baseUrl },
      stdin: stdinFromText(JSON.stringify({ objective: "run and finish" })),
      waitForTask: async ({ taskId, operation }) => ({
        exitCode: 0,
        body: {
          ok: true,
          operation,
          task_id: taskId,
          status: "review",
          timed_out: false,
          waited_ms: 10,
          review_package: { task_id: taskId, status: "review" },
        },
      }),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.body.operation, "start-and-wait");
    assert.equal(result.body.task_id, "task_done");
    assert.equal(result.body.status, "review");
    assert.equal(result.body.timed_out, false);
  } finally {
    await closeServer(mock.server);
  }
});

test("start-and-wait returns structured error when daemon is unreachable", async () => {
  const result = await runClient(["start-and-wait", "--timeout-seconds", "1"], {
    stdin: JSON.stringify({ objective: "test" }),
    env: { MIMO_BRIDGE_URL: "http://127.0.0.1:1" },
  });
  assert.equal(result.code, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.operation, "start-and-wait");
  assert.match(out.error, /Cannot connect|did not respond/);
});

test("all CLI outputs include ok and operation fields", async () => {
  const result = await runClient(["unknown-command"]);
  assert.equal(result.code, 1);
  const out = JSON.parse(result.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.operation, "unknown-command");
  assert.ok("error" in out);
});

test("PowerShell wrapper is a thin launcher and does not construct JSON", () => {
  const wrapper = readFileSync(PS_WRAPPER_PATH, "utf8");
  assert.match(wrapper, /mimo-bridge-client\.mjs/);
  assert.doesNotMatch(wrapper, /ConvertTo-Json/);
  assert.doesNotMatch(wrapper, /JSON\.stringify/);
  assert.doesNotMatch(wrapper, /objective/);
});
