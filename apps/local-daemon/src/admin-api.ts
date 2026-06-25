import type { IncomingMessage, ServerResponse } from "node:http";
import { z, type ZodError } from "zod";
import { fail, ok } from "./api-result.js";
import { readJsonBody, sendJson } from "./http-utils.js";
import type { DaemonConfig } from "./daemon-config.js";
import type { ToolContext } from "./tool-context.js";
import { readLiveTaskView, parseLiveParams } from "./live-task-view.js";
import { getPendingReviewCount } from "../../../src/services/pending-reviews.js";
import { createOpenTaskTargetHandler } from "./task-open-actions.js";

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
  scope_mode: z.enum(["strict", "suggested", "repo-wide"]).default("strict"),
  include_tests: z.enum(["auto", "always", "never"]).default("auto"),
  repo_wide_confirmed: z.boolean().default(false),
  origin_codex_thread_id: z.string().optional(),
  origin_codex_thread_url: z.string().optional(),
  origin_source: z.string().optional(),
});

const AgentStartTaskBodySchema = StartTaskBodySchema.extend({
  agent_id: z.string().min(1).default("mimo"),
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

const AgentActionBodySchema = z.object({
  agent_id: z.string().min(1).optional(),
});

const AgentFinishBodySchema = FinishBodySchema.extend({
  agent_id: z.string().min(1).optional(),
});

const AgentWorktreeBodySchema = WorktreeBodySchema.extend({
  agent_id: z.string().min(1).optional(),
});

const OpenTaskBodySchema = z.object({
  action: z.enum(["task_folder", "session_folder", "reasonix_gui"]),
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

const WaitBodySchema = z.object({
  agent_id: z.string().min(1).optional(),
  timeout_seconds: z.number().int().min(1).max(3600).default(1800),
  detail_level: z.enum(["summary", "review"]).default("review"),
  max_chars: z.number().int().min(1000).max(20000).default(8000),
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

    if (req.method === "GET" && url.pathname === "/api/agents") {
      const data = await context.tools.agentList.handler({});
      sendJson(res, 200, wrapToolResult(data));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      const limit = parseLimit(url.searchParams.get("limit"));
      const data = await context.tools.listTasks.handler({ limit });
      sendJson(res, 200, wrapToolResult(augmentListTasksResult(data, context)));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/pending-reviews") {
      const data = await context.tools.pendingReviews.handler({
        limit: parseLimit(url.searchParams.get("limit")),
        max_chars: parseMaxChars(url.searchParams.get("max_chars")),
      });
      sendJson(res, 200, wrapToolResult(data));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agent-pending-reviews") {
      const data = await context.tools.agentPendingReviews.handler({
        agent_id: url.searchParams.get("agent_id") ?? undefined,
        limit: parseLimit(url.searchParams.get("limit")),
        max_chars: parseMaxChars(url.searchParams.get("max_chars")),
      });
      sendJson(res, 200, wrapToolResult(data));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = StartTaskBodySchema.parse(await readJsonBody(req));
      const data = await context.tools.startTask.handler(body);
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/agent-tasks") {
      const body = AgentStartTaskBodySchema.parse(await readJsonBody(req));
      const data = await context.tools.agentStartTask.handler(body);
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/agent-tasks") {
      const data = await context.tools.agentListTasks.handler({
        agent_id: url.searchParams.get("agent_id") ?? undefined,
        limit: parseLimit(url.searchParams.get("limit")),
      });
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
      return true;
    }

    const agentTaskMatch = /^\/api\/agent-tasks\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (agentTaskMatch) {
      const taskId = decodeURIComponent(agentTaskMatch[1]);
      const action = agentTaskMatch[2] ?? "";

      if (req.method === "GET" && action === "") {
        const query = TaskQuerySchema.parse(parseTaskQuery(url.searchParams));
        const agentId = url.searchParams.get("agent_id") ?? undefined;
        const data = await context.tools.agentGetTask.handler({
          task_id: taskId,
          agent_id: agentId,
          ...query,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(augmentTaskResult(data, context)));
        return true;
      }

      if (req.method === "POST" && action === "wait") {
        const body = WaitBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.agentWaitTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(augmentTaskResult(data, context)));
        return true;
      }

      if (req.method === "POST" && action === "replies") {
        const body = ReplyBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.agentReplyTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "cancel") {
        const body = AgentActionBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.agentCancelTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "finish") {
        const body = AgentFinishBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.agentFinishTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "worktree") {
        const body = AgentWorktreeBodySchema.parse(await readJsonBody(req));
        const data = await context.tools.agentMergeTask.handler({
          task_id: taskId,
          ...body,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "POST" && action === "open") {
        const body = OpenTaskBodySchema.merge(AgentActionBodySchema).parse(await readJsonBody(req));
        const agentCheck = await context.tools.agentGetTask.handler({
          task_id: taskId,
          agent_id: body.agent_id,
          detail_level: "summary",
          max_chars: 1000,
          log_tail_lines: 20,
          include_diff: false,
          include_logs: false,
          include_files: false,
          file_paths: [],
          diff_paths: [],
        });
        if ("error" in agentCheck) {
          sendJson(res, toolStatusCode(agentCheck), wrapToolResult(agentCheck));
          return true;
        }
        const data = await createOpenTaskTargetHandler(config, context.taskStore).handler({
          task_id: taskId,
          action: body.action,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }

      if (req.method === "DELETE" && action === "") {
        const agentId = url.searchParams.get("agent_id") ?? undefined;
        const data = await context.tools.agentDeleteTask.handler({
          task_id: taskId,
          agent_id: agentId,
        });
        sendJson(res, toolStatusCode(data), wrapToolResult(data));
        return true;
      }
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

      if (req.method === "POST" && action === "open") {
        const body = OpenTaskBodySchema.parse(await readJsonBody(req));
        const data = await createOpenTaskTargetHandler(config, context.taskStore).handler({
          task_id: taskId,
          action: body.action,
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

    if (req.method === "GET" && url.pathname === "/api/agent-queue") {
      const data = await context.tools.agentQueueStatus.handler({
        agent_id: url.searchParams.get("agent_id") ?? undefined,
      });
      sendJson(res, toolStatusCode(data), wrapToolResult(data));
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
    pending_reviews: {
      count: getPendingReviewCount(context.taskStore),
      command: "node scripts\\mimo-bridge-client.mjs recover",
    },
    agents: {
      configured: config.agents.map((agent) => ({
        id: agent.id,
        kind: agent.kind,
        enabled: agent.enabled !== false,
      })),
      endpoint: "/api/agents",
    },
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

function parseMaxChars(raw: string | null): number {
  const value = raw ? Number(raw) : 8000;
  if (!Number.isInteger(value) || value < 1000) {
    return 8000;
  }
  return Math.min(value, 20000);
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
      const hasWorktree = Boolean(stored.worktree);
      const safeDelete = computeSafeDelete(stored.status, hasWorktree);
      return {
        ...task,
        objective: stored.config.objective,
        created_at: stored.created_at,
        updated_at: stored.updated_at,
        current_round: stored.current_round,
        has_worktree: hasWorktree,
        can_delete: safeDelete.can_delete,
        delete_blockers: safeDelete.delete_blockers,
        delete_label: safeDelete.delete_label,
        origin_codex_thread_id: stored.config.origin_codex_thread_id ?? null,
        origin_codex_thread_url: stored.config.origin_codex_thread_url ?? null,
        origin_source: stored.config.origin_source ?? null,
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

  const hasWorktree = Boolean(stored.worktree);
  const safeDelete = computeSafeDelete(stored.status, hasWorktree);

  return {
    ...data,
    objective: stored.config.objective,
    created_at: stored.created_at,
    updated_at: stored.updated_at,
    current_round: stored.current_round,
    has_worktree: hasWorktree,
    can_delete: safeDelete.can_delete,
    delete_blockers: safeDelete.delete_blockers,
    delete_label: safeDelete.delete_label,
    origin_codex_thread_id: stored.config.origin_codex_thread_id ?? null,
    origin_codex_thread_url: stored.config.origin_codex_thread_url ?? null,
    origin_source: stored.config.origin_source ?? null,
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
    "agent_session_path",
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

const TERMINAL_STATUSES = new Set(["accepted", "failed", "cancelled", "abandoned"]);

function computeSafeDelete(status: string, hasWorktree: boolean): { can_delete: boolean; delete_blockers: string[]; delete_label: string } {
  const blockers: string[] = [];
  if (!TERMINAL_STATUSES.has(status)) {
    blockers.push("任务未结束");
  }
  if (hasWorktree) {
    blockers.push("存在 Worktree");
  }
  const can_delete = blockers.length === 0;
  return {
    can_delete,
    delete_blockers: blockers,
    delete_label: can_delete ? "可安全删除" : "不可删除",
  };
}
