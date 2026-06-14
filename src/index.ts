import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TaskStore } from "./services/task-store.js";
import { createStartTaskHandler } from "./tools/start-task.js";
import { createGetTaskHandler } from "./tools/get-task.js";
import { createReplyTaskHandler } from "./tools/reply-task.js";

async function main() {
  const config = loadConfig();
  const taskStore = new TaskStore(config.runtimeDir);

  const server = new McpServer({
    name: "mimo-bridge-mcp-server",
    version: "0.1.0",
  });

  const startTask = createStartTaskHandler(config, taskStore);
  const getTask = createGetTaskHandler(taskStore);
  const replyTask = createReplyTaskHandler(config, taskStore);

  server.tool(
    "mimo_start_task",
    "创建并后台启动 MiMo 任务",
    startTask.schema.shape,
    async (params) => {
      const result = await startTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_get_task",
    "查询 MiMo 任务状态、回复和日志摘要",
    getTask.schema.shape,
    async (params) => {
      const result = await getTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_reply_task",
    "继续已有 MiMo 会话，发送回复消息",
    replyTask.schema.shape,
    async (params) => {
      const result = await replyTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("mimo-bridge-mcp-server 已启动\n");
}

main().catch((err) => {
  process.stderr.write(`启动失败: ${err.message}\n`);
  process.exit(1);
});
