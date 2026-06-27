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
  const raw = stripUtf8Bom(Buffer.concat(chunks).toString("utf8")).trim();
  return raw ? JSON.parse(raw) : {};
}

function readJsonFile(filePath) {
  return JSON.parse(stripUtf8Bom(readFileSync(filePath, "utf8")));
}

function stripUtf8Bom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
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

async function agentListOperation({ baseUrl }) {
  const response = await fetchJson(baseUrl, "/api/agents");
  return normalizeRestEnvelope("agent-list", response, (data) => ({ agents: data.agents ?? [] }));
}

function getAgentId(args, input = {}) {
  return String(args["agent-id"] || args.agent_id || input.agent_id || "");
}

function buildReplyBody(input, args, extra = {}) {
  const body = {
    message: input.message,
    ...extra,
  };
  const fields = [
    ["priority", args.priority ?? input.priority],
    ["routing_mode", args["routing-mode"] ?? args.routing_mode ?? input.routing_mode],
    ["task_scenario", args["task-scenario"] ?? args.task_scenario ?? input.task_scenario],
    ["model", args.model ?? input.model],
    ["reasoning_effort", args["reasoning-effort"] ?? args.reasoning_effort ?? input.reasoning_effort],
    ["has_images", args["has-images"] ?? args.has_images ?? input.has_images],
    ["attachments", input.attachments],
  ];
  for (const [field, value] of fields) {
    if (value !== undefined) {
      body[field] = field === "priority" ? Number(value) : normalizeBooleanField(value);
    }
  }
  return body;
}

function normalizeBooleanField(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

async function agentStartOperation({ args, baseUrl, stdin }) {
  let input;
  try {
    input = await readJsonInput(args, stdin);
  } catch (error) {
    return failure("agent-start", `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!input.objective) {
    return failure("agent-start", "Missing required field: objective");
  }

  const agentId = getAgentId(args, input);
  if (!agentId) {
    return failure("agent-start", "Missing required field: agent_id or --agent-id");
  }

  const body = {
    ...input,
    agent_id: agentId,
    workspace_path: input.workspace_path || process.cwd(),
  };
  const response = await fetchJson(baseUrl, "/api/agent-tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return normalizeRestEnvelope("agent-start", response, (data) => ({
    task_id: data.task_id,
    status: data.status,
    agent: data.agent ?? agentId,
  }));
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
  return normalizePendingReviewsEnvelope("recover", response);
}

async function agentRecoverOperation({ args, baseUrl }) {
  const params = new URLSearchParams({
    limit: String(args.limit || 10),
    max_chars: String(args["max-chars"] || args.max_chars || 8000),
  });
  const agentId = getAgentId(args);
  if (agentId) {
    params.set("agent_id", agentId);
  }
  const response = await fetchJson(baseUrl, `/api/agent-pending-reviews?${params}`);
  return normalizePendingReviewsEnvelope("agent-recover", response, agentId);
}

function normalizePendingReviewsEnvelope(operation, response, agentId = "") {
  return normalizeRestEnvelope(operation, response, (data) => ({
    agent_id: (data.agent_id ?? agentId) || null,
    pending_count: data.pending_count ?? 0,
    returned_count: data.returned_count ?? 0,
    truncated: Boolean(data.truncated),
    tasks: Array.isArray(data.tasks) ? data.tasks.map(toSafePendingReviewSummary) : [],
    next_review_command: data.next_review_command ?? null,
    recovery_note: data.recovery_note,
  }));
}

function toSafePendingReviewSummary(task) {
  return {
    task_id: task.task_id,
    agent: task.agent,
    status: task.status,
    updated_at: task.updated_at,
    current_round: task.current_round,
    objective: task.objective,
    changed_files_count: task.changed_files_count,
    risk_flags: task.risk_flags,
    review_recommendation: task.review_recommendation,
    has_worktree: task.has_worktree,
    origin_codex_thread_id: task.origin_codex_thread_id,
    origin_codex_thread_url: task.origin_codex_thread_url,
    review_command: task.review_command,
  };
}

async function agentReviewOperation({ args, baseUrl }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("agent-review", "Missing required option: --task-id");
  }

  const params = new URLSearchParams({
    detail_level: String(args["detail-level"] || args.detail_level || "review"),
    max_chars: String(args["max-chars"] || args.max_chars || 8000),
  });
  const agentId = getAgentId(args);
  if (agentId) {
    params.set("agent_id", agentId);
  }
  const response = await fetchJson(baseUrl, `/api/agent-tasks/${encodeURIComponent(taskId)}?${params}`);
  return normalizeRestEnvelope("agent-review", response, (data) => ({
    task_id: taskId,
    agent: (data.agent ?? agentId) || undefined,
    status: data.status,
    detail_level: data.detail_level,
    review_package: data.review_package,
  }));
}

async function replyOperation({ args, baseUrl, stdin }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("reply", "Missing required option: --task-id");
  }

  let input;
  try {
    input = args.message ? { message: String(args.message) } : await readJsonInput(args, stdin);
  } catch (error) {
    return failure("reply", `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!input.message) {
    return failure("reply", "Missing required field: message or --message");
  }

	  const response = await fetchJson(baseUrl, `/api/tasks/${encodeURIComponent(taskId)}/replies`, {
	    method: "POST",
	    body: JSON.stringify(buildReplyBody(input, args)),
	  });
  return normalizeRestEnvelope("reply", response, (data) => ({
    task_id: data.task_id ?? taskId,
    status: data.status,
  }));
}

async function agentReplyOperation({ args, baseUrl, stdin }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("agent-reply", "Missing required option: --task-id");
  }

  let input;
  try {
    input = args.message ? { message: String(args.message) } : await readJsonInput(args, stdin);
  } catch (error) {
    return failure("agent-reply", `Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!input.message) {
    return failure("agent-reply", "Missing required field: message or --message");
  }

  const agentId = getAgentId(args, input);
	  const response = await fetchJson(baseUrl, `/api/agent-tasks/${encodeURIComponent(taskId)}/replies`, {
	    method: "POST",
	    body: JSON.stringify(buildReplyBody(input, args, agentId ? { agent_id: agentId } : {})),
	  });
  return normalizeRestEnvelope("agent-reply", response, (data) => ({
    task_id: data.task_id ?? taskId,
    agent: (data.agent ?? agentId) || undefined,
    status: data.status,
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

async function agentWaitOperation({ args, baseUrl, waitForTaskImpl }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure("agent-wait", "Missing required option: --task-id");
  }
  const agentId = getAgentId(args);
  return waitForTaskImpl({
    baseUrl,
    taskId,
    agentId,
    timeoutSeconds: Number(args["timeout-seconds"] || args.timeout_seconds || 1800),
    detailLevel: String(args["detail-level"] || args.detail_level || "review"),
    maxChars: Number(args["max-chars"] || args.max_chars || 8000),
    operation: "agent-wait",
    toolName: "agent_wait_task",
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

async function agentStartAndWaitOperation({ args, baseUrl, stdin, waitForTaskImpl }) {
  const started = await agentStartOperation({ args, baseUrl, stdin });
  if (started.exitCode !== 0) {
    return { ...started, body: { ...started.body, operation: "agent-start-and-wait" } };
  }

  return waitForTaskImpl({
    baseUrl,
    taskId: started.body.task_id,
    agentId: started.body.agent || getAgentId(args),
    timeoutSeconds: Number(args["timeout-seconds"] || args.timeout_seconds || 1800),
    detailLevel: String(args["detail-level"] || args.detail_level || "review"),
    maxChars: Number(args["max-chars"] || args.max_chars || 8000),
    operation: "agent-start-and-wait",
    toolName: "agent_wait_task",
  });
}

async function agentLifecycleOperation({ args, baseUrl, operation, pathSuffix, method = "POST", body = {} }) {
  const taskId = String(args["task-id"] || args.task_id || "");
  if (!taskId) {
    return failure(operation, "Missing required option: --task-id");
  }
  const agentId = getAgentId(args);
  const query = method === "DELETE" && agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const response = await fetchJson(baseUrl, `/api/agent-tasks/${encodeURIComponent(taskId)}${pathSuffix}${query}`, {
    method,
    body: method === "DELETE" ? undefined : JSON.stringify({
      ...body,
      ...(agentId ? { agent_id: agentId } : {}),
    }),
  });
  return normalizeRestEnvelope(operation, response, (data) => ({
    task_id: data.task_id ?? taskId,
    agent: (data.agent ?? agentId) || undefined,
    status: data.status,
    action: data.action,
  }));
}

async function agentQueueOperation({ args, baseUrl }) {
  const params = new URLSearchParams();
  const agentId = getAgentId(args);
  if (agentId) {
    params.set("agent_id", agentId);
  }
  const query = params.toString() ? `?${params}` : "";
  const response = await fetchJson(baseUrl, `/api/agent-queue${query}`);
  return normalizeRestEnvelope("agent-queue", response, (data) => ({
    running: data.running ?? 0,
    queued: data.queued ?? 0,
    queue: data.queue ?? [],
    agent_id: (data.agent_id ?? agentId) || undefined,
  }));
}

async function tokenStatusOperation({ baseUrl, operation = "token-status" }) {
  const response = await fetchJson(baseUrl, "/api/token-budget");
  return normalizeRestEnvelope(operation, response, (data) => ({
    status: data.status,
    used: data.used,
    remaining: data.remaining,
    utilization: data.utilization,
    warnings: data.warnings,
    exceeded: data.exceeded,
    report: data.report,
  }));
}

async function agentTasksOperation({ args, baseUrl }) {
  const params = new URLSearchParams({
    limit: String(args.limit || 10),
  });
  const agentId = getAgentId(args);
  if (agentId) {
    params.set("agent_id", agentId);
  }
  const response = await fetchJson(baseUrl, `/api/agent-tasks?${params}`);
  return normalizeRestEnvelope("agent-tasks", response, (data) => ({
    agent_id: (data.agent_id ?? agentId) || null,
    returned_count: data.returned_count ?? 0,
    tasks: Array.isArray(data.tasks) ? data.tasks.map(toSafeTaskSummary) : [],
  }));
}

function toSafeTaskSummary(task) {
  return {
    task_id: task.task_id,
    agent: task.agent,
    status: task.status,
    objective: task.objective,
    summary: task.summary,
    modified_files_count: task.modified_files_count,
    risk_flags: task.risk_flags,
    review_recommendation: task.review_recommendation,
    created_at: task.created_at,
    updated_at: task.updated_at,
    current_round: task.current_round,
    has_worktree: task.has_worktree,
    can_delete: task.can_delete,
    delete_blockers: task.delete_blockers,
  };
}

async function waitForTask({ baseUrl, taskId, agentId, timeoutSeconds, detailLevel, maxChars, operation, toolName = "mimo_wait_task" }) {
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl));
  const client = new Client({ name: "mimo-bridge-client", version: "0.1.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool(
      {
        name: toolName,
        arguments: {
          task_id: taskId,
          ...(agentId ? { agent_id: agentId } : {}),
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
      agent: (data.agent ?? agentId) || undefined,
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
      "node scripts/mimo-bridge-client.mjs reply --task-id task_xxx --json .\\runtime\\client-requests\\reply.json --model mimo-v2.5-pro --reasoning-effort high",
      "node scripts/mimo-bridge-client.mjs start-and-wait --json .\\runtime\\client-requests\\task.json --timeout-seconds 1800",
      "node scripts/mimo-bridge-client.mjs review --task-id task_xxx --detail-level review --max-chars 8000",
      "node scripts/mimo-bridge-client.mjs recover --limit 10 --max-chars 8000",
      "node scripts/mimo-bridge-client.mjs agent-list",
      "node scripts/mimo-bridge-client.mjs agent-start --agent-id reasonix-tui --json .\\runtime\\client-requests\\task.json",
      "node scripts/mimo-bridge-client.mjs agent-wait --agent-id reasonix-tui --task-id task_xxx --timeout-seconds 1800",
      "node scripts/mimo-bridge-client.mjs agent-reply --agent-id reasonix-tui --task-id task_xxx --json .\\runtime\\client-requests\\reply.json --model deepseek-v4-pro --reasoning-effort high",
      "node scripts/mimo-bridge-client.mjs agent-start-and-wait --agent-id reasonix-tui --json .\\runtime\\client-requests\\task.json --timeout-seconds 1800",
      "node scripts/mimo-bridge-client.mjs agent-review --agent-id reasonix-tui --task-id task_xxx --detail-level review --max-chars 8000",
      "node scripts/mimo-bridge-client.mjs agent-tasks --agent-id reasonix-tui --limit 10",
      "node scripts/mimo-bridge-client.mjs agent-recover --agent-id reasonix-tui --limit 10 --max-chars 8000",
      "node scripts/mimo-bridge-client.mjs agent-finish --agent-id reasonix-tui --task-id task_xxx --status accepted",
      "node scripts/mimo-bridge-client.mjs agent-merge --agent-id reasonix-tui --task-id task_xxx --action merge",
      "node scripts/mimo-bridge-client.mjs agent-delete --agent-id reasonix-tui --task-id task_xxx",
      "node scripts/mimo-bridge-client.mjs agent-queue --agent-id reasonix-tui",
      "node scripts/mimo-bridge-client.mjs agent-token-status",
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
    case "agent-list":
    case "agents":
      return agentListOperation({ args, baseUrl, stdin });
    case "agent-start":
      return agentStartOperation({ args, baseUrl, stdin });
    case "wait":
      return waitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "reply":
      return replyOperation({ args, baseUrl, stdin });
    case "agent-wait":
      return agentWaitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "agent-reply":
      return agentReplyOperation({ args, baseUrl, stdin });
    case "start-and-wait":
      return startAndWaitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "agent-start-and-wait":
      return agentStartAndWaitOperation({ args, baseUrl, stdin, waitForTaskImpl });
    case "review":
      return reviewOperation({ args, baseUrl, stdin });
    case "agent-review":
      return agentReviewOperation({ args, baseUrl, stdin });
    case "agent-tasks":
    case "agent-list-tasks":
      return agentTasksOperation({ args, baseUrl, stdin });
    case "agent-recover":
    case "agent-pending-reviews":
      return agentRecoverOperation({ args, baseUrl, stdin });
    case "recover":
    case "pending-reviews":
      return recoverOperation({ args, baseUrl, stdin });
    case "agent-cancel":
      return agentLifecycleOperation({ args, baseUrl, operation: "agent-cancel", pathSuffix: "/cancel" });
    case "agent-finish":
      return agentLifecycleOperation({
        args,
        baseUrl,
        operation: "agent-finish",
        pathSuffix: "/finish",
        body: { status: String(args.status || "accepted") },
      });
    case "agent-merge":
      return agentLifecycleOperation({
        args,
        baseUrl,
        operation: "agent-merge",
        pathSuffix: "/worktree",
        body: { action: String(args.action || "merge") },
      });
    case "agent-discard":
      return agentLifecycleOperation({
        args,
        baseUrl,
        operation: "agent-discard",
        pathSuffix: "/worktree",
        body: { action: "discard" },
      });
    case "agent-delete":
      return agentLifecycleOperation({ args, baseUrl, operation: "agent-delete", pathSuffix: "", method: "DELETE" });
    case "agent-queue":
      return agentQueueOperation({ args, baseUrl, stdin });
    case "token-status":
      return tokenStatusOperation({ baseUrl, operation: "token-status" });
    case "agent-token-status":
      return tokenStatusOperation({ baseUrl, operation: "agent-token-status" });
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
