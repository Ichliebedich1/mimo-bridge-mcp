import type { IncomingMessage, ServerResponse } from "node:http";
import { z, type ZodError } from "zod";
import { fail, ok } from "./api-result.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import type { DaemonConfig } from "./daemon-config.js";
import type { ToolContext } from "./tool-context.js";
import { readLiveTaskView, parseLiveParams } from "./live-task-view.js";

const StartTaskBodySchema = z.object({
  objective: z.string().min(1),
  workspace_path: z.string().min(1),
  editable_paths: z.array(z.string()).default([]),
  readonly_paths: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  max_rounds: z.number().int().min(1).max(10).default(5),
  runtime_timeout_seconds: z.number().int().min(60).max(3600).default(900),
  use_worktree: z.boolean().default(false),
  priority: z.number().int().min(0).max(10).default(5),
});

const ReplyBodySchema = z.object({
  message: z.string().min(1),
  priority: z.number().int().min(0).max(10).default(5),
});

const FinishBodySchema = z.object({
  status: z.enum(["accepted", "abandoned"]),
});

const WorktreeBodySchema = z.object({
  action: z.enum(["merge", "discard"]),
});

const TaskQuerySchema = z.object({
  detail_level: z.enum(["summary", "review", "diff", "focused", "logs", "full"]).default("review"),
  max_chars: z.coerce.number().int().min(1000).max(20000).default(8000),
  log_tail_lines: z.coerce.number().int().min(1).max(200).default(20),
  include_diff: z.boolean().default(false),
  include_logs: z.boolean().default(false),
  include_files: z.boolean().default(false),
  file_paths: z.array(z.string()).default([]),
  diff_paths: z.array(z.string()).default([]),
});

export async function handleAdminApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: DaemonConfig,
  context: ToolContext
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, ok(getHealth(config, context)));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      const limit = parseLimit(url.searchParams.get("limit"));
      const data = await context.tools.listTasks.handler({ limit });
      sendJson(res, 200, wrapToolResult(augmentListTasksResult(data, context)));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = StartTaskBodySchema.parse(await readJsonBody(req));
      const data = await context.tools.startTask.handler(body);
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    const taskMatch = /^\/api\/tasks\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (taskMatch) {
      const taskId = decodeURIComponent(taskMatch[1]);
      const action = taskMatch[2] ?? "";

      if (req.method === "GET" && action === "") {
        const query = TaskQuerySchema.parse(parseTaskQuery(url.searchParams));
        const data = await context.tools.getTask.handler({
          task_id: taskId,
          ...query,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(augmentTaskResult(data, context)));
        return true;
      }

      if (req.method === "DELETE" && action === "") {
        const data = await context.tools.deleteTask.handler({ task_id: taskId });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "replies") {
        const body = ReplyBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.replyTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "cancel") {
        const data = await context.tools.cancelTask.handler({ task_id: taskId });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "finish") {
        const body = FinishBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.finishTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "worktree") {
        const body = WorktreeBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.mergeTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "GET" && action === "live") {
        const { max_events, max_chars } = parseLiveParams(url.searchParams);
        const result = readLiveTaskView(context.taskStore, taskId, max_events, max_chars);
        if ("error" in result) {
          sendJson(res, 404, fail(result.error));
        } else {
          sendJson(res, 200, ok(result));
        }
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/queue") {
      const startTask = context.tools.startTask;
      const data = "getQueueStatus" in startTask ? startTask.getQueueStatus() : { running: 0, queued: 0, queue: [] };
      sendJson(res, 200, ok(data));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/token-budget") {
      const data = await context.tools.tokenStatus.handler({ reset: false });
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/token-budget/reset") {
      const data = await context.tools.tokenStatus.handler({ reset: true });
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    sendJson(res, 404, fail("未知 API 路由"));
    return true;
  } catch (error) {
    if (isZodError(error)) {
      sendJson(res, 400, fail("参数校验失败", error.issues));
      return true;
    }
    sendJson(res, 500, fail(error instanceof Error ? error.message : String(error)));
    return true;
  }
}

function getHealth(config: DaemonConfig, context: ToolContext) {
  const startTask = context.tools.startTask;
  const queue = "getQueueStatus" in startTask ? startTask.getQueueStatus() : { running: 0, queued: 0, queue: [] };
  return {
    daemon: {
      status: "ok",
      host: config.host,
      port: config.port,
      degraded: context.degraded,
      config_error: context.configError,
    },
    mcp: {
      transport: "streamable_http",
      endpoint: "/mcp",
      status: context.degraded ? "degraded" : "ready",
    },
    mimo: {
      status: config.mcpConfig ? "configured" : "not_configured",
      version: config.mimoVersion,
    },
    queue,
    security: {
      localhost_only: true,
      arbitrary_tool_proxy: false,
      raw_paths_exposed: false,
    },
  };
}

function parseLimit(raw: string | null): number {
  const value = raw ? Number(raw) : 20;
  if (!Number.isInteger(value) || value < 1) {
    return 20;
  }
  return Math.min(value, 50);
}

function parseTaskQuery(params: URLSearchParams): Record<string, unknown> {
  return {
    detail_level: params.get("detail_level") ?? undefined,
    max_chars: params.get("max_chars") ?? undefined,
    log_tail_lines: params.get("log_tail_lines") ?? undefined,
    include_diff: parseBooleanParam(params.get("include_diff")),
    include_logs: parseBooleanParam(params.get("include_logs")),
    include_files: parseBooleanParam(params.get("include_files")),
    file_paths: params.getAll("file_paths"),
    diff_paths: params.getAll("diff_paths"),
  };
}

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  return value === "true" || value === "1";
}

function wrapToolResult(data: unknown) {
  if (isToolError(data)) {
    return fail(data.error, data.details ?? data);
  }
  return ok(sanitizeForBrowser(data));
}

function toolStatusCode(data: unknown): number {
  return isToolError(data) ? 400 : 200;
}

function isToolError(data: unknown): data is { error: string; details?: unknown } {
  return typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string";
}

function isZodError(error: unknown): error is ZodError {
  return typeof error === "object" && error !== null && "issues" in error;
}

function augmentListTasksResult(data: unknown, context: ToolContext): unknown {
  if (isToolError(data) || !isRecord(data) || !Array.isArray(data.tasks)) {
    return data;
  }

  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (!isRecord(task) || typeof task.task_id !== "string") {
        return task;
      }
      const stored = context.taskStore.getTask(task.task_id);
      if (!stored) {
        return task;
      }
      return {
        ...task,
        objective: stored.config.objective,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        current_round: stored.current_round,
        has_worktree: Boolean(stored.worktree),
      };
    }),
  };
}

function augmentTaskResult(data: unknown, context: ToolContext): unknown {
  if (isToolError(data) || !isRecord(data) || typeof data.task_id !== "string") {
    return data;
  }

  const stored = context.taskStore.getTask(data.task_id);
  if (!stored) {
    return data;
  }

  return {
    ...data,
    objective: stored.config.objective,
    created_at: stored.created_at,
    updated_at: stored.updated_at,
    current_round: stored.current_round,
    has_worktree: Boolean(stored.worktree),
  };
}

function sanitizeForBrowser(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForBrowser);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const blockedKeys = new Set([
    "raw_log_path",
    "stderr_log_path",
    "worktree_path",
    "workspace_path",
    "repo_path",
    "worktrees_root",
    "mimoNodePath",
    "mimoEntryPath",
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (blockedKeys.has(key)) {
      continue;
    }
    result[key] = sanitizeForBrowser(nestedValue);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
