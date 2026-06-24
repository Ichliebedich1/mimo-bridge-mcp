import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext } from "./tool-context.js";

type TransportMap = Record<string, StreamableHTTPServerTransport>;

export interface McpHttpBridge {
  handlePost(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
  handleGet(req: IncomingMessage, res: ServerResponse): Promise<void>;
  handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

export function createMcpHttpBridge(context: ToolContext): McpHttpBridge {
  const transports: TransportMap = {};

  async function handlePost(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    try {
      let transport: StreamableHTTPServerTransport;
      if (typeof sessionId === "string" && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });
        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (closedSessionId) {
            delete transports[closedSessionId];
          }
        };
        const server = createMcpServer(context);
        await server.connect(transport);
      } else {
        writeMcpError(res, 400, "Bad Request: No valid session ID provided");
        return;
      }

      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) {
        writeMcpError(res, 500, "Internal server error");
      }
    }
  }

  async function handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !transports[sessionId]) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  }

  async function handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId !== "string" || !transports[sessionId]) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  }

  async function close(): Promise<void> {
    await Promise.all(Object.values(transports).map((transport) => transport.close()));
  }

  return { handlePost, handleGet, handleDelete, close };
}

function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({
    name: "mimo-bridge-local-daemon",
    version: "0.1.0-ui1",
  });

  registerJsonTool(server, "mimo_start_task", "创建并后台启动 MiMo 任务", context.tools.startTask);
  registerJsonTool(server, "mimo_get_task", "按 token 预算查询任务", context.tools.getTask);
  registerJsonTool(server, "mimo_wait_task", "低 Token 等待任务状态变化，完成后返回受限审查摘要", context.tools.waitTask);
  registerJsonTool(server, "mimo_reply_task", "继续已有 MiMo 会话，发送回复消息", context.tools.replyTask);
  registerJsonTool(server, "mimo_cancel_task", "终止运行中的 MiMo 任务或取消队列中的任务", context.tools.cancelTask);
  registerJsonTool(server, "mimo_finish_task", "标记任务为验收通过或放弃", context.tools.finishTask);
  registerJsonTool(server, "mimo_list_tasks", "列出最近的任务及状态", context.tools.listTasks);
  registerJsonTool(server, "mimo_pending_reviews", "低上下文恢复入口：列出已经完成、正在等待 Codex 审查的 MiMo 任务", context.tools.pendingReviews);
  registerJsonTool(server, "mimo_merge_task", "合并或丢弃任务的 Worktree 修改", context.tools.mergeTask);
  registerJsonTool(server, "agent_list", "列出可用执行 Agent，包括 MiMo 和 Reasonix TUI 探测状态", context.tools.agentList);
  registerJsonTool(server, "agent_start_task", "使用指定 Agent 创建并后台启动任务；P6 当前支持 mimo 与 reasonix-tui one-shot", context.tools.agentStartTask);
  server.tool("mimo_queue_status", "查询任务队列状态", {}, async () => {
    const startTask = context.tools.startTask;
    const result = "getQueueStatus" in startTask ? startTask.getQueueStatus() : { running: 0, queued: 0, queue: [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });
  registerJsonTool(server, "mimo_token_status", "查询 Token 预算使用情况", context.tools.tokenStatus);
  registerJsonTool(server, "mimo_delete_task", "永久删除已结束且没有 Worktree 的任务及其运行时文件", context.tools.deleteTask);

  return server;
}

function registerJsonTool(
  server: McpServer,
  name: string,
  description: string,
  tool: { schema: { shape: Record<string, unknown> }; handler: (input: any) => Promise<unknown> }
): void {
  server.tool(name, description, tool.schema.shape, async (params) => {
    const result = await tool.handler(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });
}

function writeMcpError(res: ServerResponse, statusCode: number, message: string): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
