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

  registerJsonTool(server, "mimo_start_task", "Create and start a MiMo task", context.tools.startTask);
  registerJsonTool(server, "mimo_get_task", "Read a MiMo task with bounded detail levels", context.tools.getTask);
  registerJsonTool(server, "mimo_wait_task", "Low-token wait for a MiMo task", context.tools.waitTask);
  registerJsonTool(server, "mimo_reply_task", "Reply to an existing MiMo task", context.tools.replyTask);
  registerJsonTool(server, "mimo_cancel_task", "Cancel a queued or running MiMo task", context.tools.cancelTask);
  registerJsonTool(server, "mimo_finish_task", "Mark a MiMo task as accepted or abandoned", context.tools.finishTask);
  registerJsonTool(server, "mimo_list_tasks", "List recent tasks", context.tools.listTasks);
  registerJsonTool(server, "mimo_pending_reviews", "List completed tasks waiting for Codex review", context.tools.pendingReviews);
  registerJsonTool(server, "mimo_merge_task", "Merge or discard a task Worktree", context.tools.mergeTask);

  registerJsonTool(server, "agent_list", "List configured execution agents", context.tools.agentList);
  registerJsonTool(server, "agent_start_task", "Create and start a task with a selected agent", context.tools.agentStartTask);
  registerJsonTool(server, "agent_reply_task", "Reply to a task owned by a selected agent", context.tools.agentReplyTask);
  registerJsonTool(server, "agent_get_task", "Read any agent task with bounded detail levels", context.tools.agentGetTask);
  registerJsonTool(server, "agent_wait_task", "Low-token wait for any agent task", context.tools.agentWaitTask);
  registerJsonTool(server, "agent_cancel_task", "Cancel a queued or running task for any supported agent", context.tools.agentCancelTask);
  registerJsonTool(server, "agent_finish_task", "Mark any supported agent task as accepted or abandoned", context.tools.agentFinishTask);
  registerJsonTool(server, "agent_merge_task", "Merge or discard any supported agent task Worktree", context.tools.agentMergeTask);
  registerJsonTool(server, "agent_delete_task", "Delete a terminal agent task after its Worktree is gone", context.tools.agentDeleteTask);
  registerJsonTool(server, "agent_queue_status", "Show the shared task queue, optionally filtered by agent_id", context.tools.agentQueueStatus);

  server.tool("mimo_queue_status", "Show the shared task queue", {}, async () => {
    const startTask = context.tools.startTask;
    const result = "getQueueStatus" in startTask ? startTask.getQueueStatus() : { running: 0, queued: 0, queue: [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  registerJsonTool(server, "mimo_token_status", "Show token budget status", context.tools.tokenStatus);
  registerJsonTool(server, "mimo_delete_task", "Delete a terminal task after its Worktree is gone", context.tools.deleteTask);

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
