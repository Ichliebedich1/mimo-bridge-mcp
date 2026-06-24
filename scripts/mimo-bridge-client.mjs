#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const DEFAULT_BASE_URL = "http://127.0.0.1:3210";

const DEFAULT_REST_TIMEOUT_MS = 15_000;
const MCP_CLOSE_TIMEOUT_MS = 2_000;

export function getBaseUrl(env = process.env) {
  return (env.MIMO_BRIDGE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function sdkRequestTimeoutMs(timeoutSeconds) {
  const seconds = Number(timeoutSeconds);
  if (!Number.isFinite(seconds) || seconds < 1) {
    return 1_000 + 60_000;
  }
  return Math.ceil(seconds * 1000) + 60_000;
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function command(args) {
  return args._[0] || "";
}

async function readStdinJson(stdin = process.stdin) {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

async function readJsonInput(args, stdin = process.stdin) {
  if (args.json) {
    return readJsonFile(String(args.json));
  }
  return readStdinJson(stdin);
}

async function fetchJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      body: options.body,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        ...(options.headers ?? {}),
      },
    });

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        status: response.status,
        error: "Daemon returned a non-JSON response.",
      };
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: connectionErrorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function connectionErrorMessage(error) {
  if (error instanceof Error && error.name === "AbortError") {
    return "MiMo Bridge daemon did not respond before the client timeout.";
  }
  return "Cannot connect to MiMo Bridge daemon. Check MIMO_BRIDGE_URL and make sure the daemon is running.";
}

function normalizeRestEnvelope(operation, response, extract) {
  if (!response.ok || !response.body?.ok) {
    return failure(operation, response.body?.error || response.error || "MiMo Bridge request failed.", {
      status: response.status,
    });
  }
  return success(operation, extract(response.body.data ?? {}));
}

function success(operation, fields = {}) {
  return {
    exitCode: 0,
    body: {
      ok: true,
      operation,
      ...fields,
    },
  };
}

function failure(operation, error, fields = {}) {
  return {
    exitCode: 1,
    body: {
      ok: false,
      operation,
      error,
      ...fields,
    },
  };
}

async function healthOperation({ baseUrl }) {
  const response = await fetchJson(baseUrl, "/api/health");
  return normalizeRestEnvelope("health", response, (data) => ({ status: data.daemon?.status ?? "unknown", data }));
}

async function startOperation({ args, baseUrl, stdin }) {
  let input;
  try {
    input = await readJsonInput(args, stdin);
  } catch (error) {
    return failure("start", `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!input.objective) {
    return failure("start", "Missing required field: objective");
  }

  const body = {
    ...input,
    workspace_path: input.workspace_path || process.cwd(),
  };
  const response = await fetchJson(baseUrl, "/api/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return normalizeRestEnvelope("start", response, (data) => ({ task_id: data.task_id, status: data.status }));
}

async function reviewOperation({ args, baseUrl }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("review", "Missing required option: --task-id");
  }

  const params = new URLSearchParams({
    detail_level: String(args["detail-level"] || args.detail_level || "review"),
    max_chars: String(args["max-chars"] || args.max_chars || 8000),
  });
  const response = await fetchJson(baseUrl, `/api/tasks/${encodeURIComponent(taskId)}?${params}`);
  return normalizeRestEnvelope("review", response, (data) => ({
    task_id: taskId,
    status: data.status,
    detail_level: data.detail_level,
    review_package: data.review_package,
  }));
}

async function recoverOperation({ args, baseUrl }) {
  const params = new URLSearchParams({
    limit: String(args.limit || 10),
    max_chars: String(args["max-chars"] || args.max_chars || 8000),
  });
  const response = await fetchJson(baseUrl, `/api/pending-reviews?${params}`);
  return normalizeRestEnvelope("recover", response, (data) => ({
    pending_count: data.pending_count ?? 0,
    returned_count: data.returned_count ?? 0,
    truncated: Boolean(data.truncated),
    tasks: data.tasks ?? [],
    next_review_command: data.next_review_command ?? null,
    recovery_note: data.recovery_note,
  }));
}

async function waitOperation({ args, baseUrl, waitForTaskImpl }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("wait", "Missing required option: --task-id");
  }
  return waitForTaskImpl({
    baseUrl,
    taskId,
    timeoutSeconds: Number(args["timeout-seconds"] || args.timeout_seconds || 1800),
    detailLevel: String(args["detail-level"] || args.detail_level || "review"),
    maxChars: Number(args["max-chars"] || args.max_chars || 8000),
    operation: "wait",
  });
}

async function startAndWaitOperation({ args, baseUrl, stdin, waitForTaskImpl }) {
  const started = await startOperation({ args, baseUrl, stdin });
  if (started.exitCode !== 0) {
    return { ...started, body: { ...started.body, operation: "start-and-wait" } };
  }

  return waitForTaskImpl({
    baseUrl,
    taskId: started.body.task_id,
    timeoutSeconds: Number(args["timeout-seconds"] || args.timeout_seconds || 1800),
    detailLevel: String(args["detail-level"] || args.detail_level || "review"),
    maxChars: Number(args["max-chars"] || args.max_chars || 8000),
    operation: "start-and-wait",
  });
}

async function waitForTask({ baseUrl, taskId, timeoutSeconds, detailLevel, maxChars, operation }) {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl));
  const client = new Client({ name: "mimo-bridge-client", version: "0.1.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool(
      {
        name: "mimo_wait_task",
        arguments: {
          task_id: taskId,
          timeout_seconds: timeoutSeconds,
          detail_level: detailLevel,
          max_chars: maxChars,
        },
      },
      undefined,
      { timeout: sdkRequestTimeoutMs(timeoutSeconds) }
    );

    const data = parseToolText(result);
    if (data.error) {
      return failure(operation, data.error, { task_id: taskId, status: data.status });
    }

    return success(operation, {
      task_id: data.task_id || taskId,
      status: data.status,
      timed_out: Boolean(data.timed_out),
      waited_ms: data.waited_ms ?? 0,
      review_package: data.review_package,
    });
  } catch (error) {
    return failure(operation, error instanceof Error ? error.message : String(error), { task_id: taskId });
  } finally {
    await closeMcpClient(client);
  }
}

function parseToolText(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    return result ?? {};
  }
  return JSON.parse(text);
}

async function closeMcpClient(client) {
  await Promise.race([
    client.close(),
    new Promise((resolve) => setTimeout(resolve, MCP_CLOSE_TIMEOUT_MS)),
  ]).catch(() => {});
}

function helpOperation() {
  return success("help", {
    usage: [
      "node scripts/mimo-bridge-client.mjs health",
      "node scripts/mimo-bridge-client.mjs start --json .\\runtime\\client-requests\\task.json",
      "node scripts/mimo-bridge-client.mjs wait --task-id task_xxx --timeout-seconds 1800",
      "node scripts/mimo-bridge-client.mjs start-and-wait --json .\\runtime\\client-requests\\task.json --timeout-seconds 1800",
      "node scripts/mimo-bridge-client.mjs review --task-id task_xxx --detail-level review --max-chars 8000",
      "node scripts/mimo-bridge-client.mjs recover --limit 10 --max-chars 8000",
    ],
  });
}

export async function run(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const baseUrl = getBaseUrl(options.env ?? process.env);
  const stdin = options.stdin ?? process.stdin;
  const waitForTaskImpl = options.waitForTask ?? waitForTask;

  switch (command(args)) {
    case "health":
      return healthOperation({ args, baseUrl, stdin });
    case "start":
      return startOperation({ args, baseUrl, stdin });
    case "wait":
      return waitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "start-and-wait":
      return startAndWaitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "review":
      return reviewOperation({ args, baseUrl, stdin });
    case "recover":
    case "pending-reviews":
      return recoverOperation({ args, baseUrl, stdin });
    case "":
    case "help":
    case "--help":
      return helpOperation();
    default:
      return failure(command(args), `Unknown command: ${command(args)}`);
  }
}

async function writeJsonAndExit(result) {
  await new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(result.body)}\n`, resolve);
  });
  process.exit(result.exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then(writeJsonAndExit, (error) => {
    writeJsonAndExit(failure("unknown", error instanceof Error ? error.message : String(error)));
  });
}
