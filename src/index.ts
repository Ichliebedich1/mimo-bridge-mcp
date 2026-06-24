import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { TaskStore } from "./services/task-store.js";
import { createStartTaskHandler } from "./tools/start-task.js";
import { createGetTaskHandler } from "./tools/get-task.js";
import { createReplyTaskHandler } from "./tools/reply-task.js";
import { createCancelTaskHandler } from "./tools/cancel-task.js";
import { createFinishTaskHandler } from "./tools/finish-task.js";
import { createListTasksHandler } from "./tools/list-tasks.js";
import { createMergeTaskHandler } from "./tools/merge-task.js";
import { createTokenStatusHandler } from "./tools/token-status.js";
import { createDeleteTaskHandler } from "./tools/delete-task.js";
import { createWaitTaskHandler } from "./tools/wait-task.js";
import { createPendingReviewsHandler } from "./tools/pending-reviews.js";
import { createAgentRegistry } from "./services/agent-registry.js";
import { createAgentListHandler } from "./tools/agent-list.js";
import { createAgentStartTaskHandler } from "./tools/agent-start-task.js";
import { createAgentReplyTaskHandler } from "./tools/agent-reply-task.js";
import { createAgentGetTaskHandler } from "./tools/agent-get-task.js";
import { createAgentWaitTaskHandler } from "./tools/agent-wait-task.js";

async function main() {
  const config = loadConfig();
  const taskStore = new TaskStore(config.runtimeDir);

  const server = new McpServer({
    name: "mimo-bridge-mcp-server",
    version: "0.1.0",
  });

  const startTask = createStartTaskHandler(config, taskStore);
  const getTask = createGetTaskHandler(taskStore);
  const waitTask = createWaitTaskHandler(taskStore);
  const pendingReviews = createPendingReviewsHandler(taskStore);
  const agentRegistry = createAgentRegistry({
    agents: config.agents,
    mcpConfig: config,
    mimoVersion: null,
  });
  const agentList = createAgentListHandler(agentRegistry);
  const agentStartTask = createAgentStartTaskHandler(config, config.agents, taskStore);
  const agentReplyTask = createAgentReplyTaskHandler(config, config.agents, taskStore);
  const agentGetTask = createAgentGetTaskHandler(taskStore);
  const agentWaitTask = createAgentWaitTaskHandler(taskStore);
  const replyTask = createReplyTaskHandler(config, taskStore);
  const cancelTask = createCancelTaskHandler(taskStore);
  const finishTask = createFinishTaskHandler(taskStore);
  const listTasks = createListTasksHandler(taskStore);
  const mergeTask = createMergeTaskHandler(taskStore, config);
  const tokenStatus = createTokenStatusHandler();
  const deleteTask = createDeleteTaskHandler(taskStore);

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
    "按 token 预算查询任务。默认 review 仅返回 Review Package；发现风险后再显式升级为 diff、focused、logs 或 full，禁止默认读取完整内容。",
    getTask.schema.shape,
    async (params) => {
      const result = await getTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_wait_task",
    "低 Token 等待任务状态变化，完成后返回受限审查摘要",
    waitTask.schema.shape,
    async (params) => {
      const result = await waitTask.handler(params);
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

  server.tool(
    "mimo_cancel_task",
    "终止运行中的 MiMo 任务或取消队列中的任务",
    cancelTask.schema.shape,
    async (params) => {
      const result = await cancelTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_finish_task",
    "标记任务为验收通过或放弃",
    finishTask.schema.shape,
    async (params) => {
      const result = await finishTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_list_tasks",
    "列出最近的任务及状态",
    listTasks.schema.shape,
    async (params) => {
      const result = await listTasks.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_merge_task",
    "合并或丢弃任务的 Worktree 修改",
    mergeTask.schema.shape,
    async (params) => {
      const result = await mergeTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_queue_status",
    "查询任务队列状态",
    {},
    async () => {
      const result = startTask.getQueueStatus();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_pending_reviews",
    "低上下文恢复入口：列出已经完成、正在等待 Codex 审查的 MiMo 任务",
    pendingReviews.schema.shape,
    async (params) => {
      const result = await pendingReviews.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "agent_list",
    "列出可用执行 Agent，包括 MiMo 和 Reasonix TUI 探测状态",
    agentList.schema.shape,
    async (params) => {
      const result = await agentList.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "agent_start_task",
    "使用指定 Agent 创建并后台启动任务；P6 当前支持 mimo 与 reasonix-tui one-shot",
    agentStartTask.schema.shape,
    async (params) => {
      const result = await agentStartTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "agent_reply_task",
    "继续指定 Agent 任务；Reasonix TUI 使用记录的 session JSONL 恢复",
    agentReplyTask.schema.shape,
    async (params) => {
      const result = await agentReplyTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
  server.tool(
    "agent_get_task",
    "按 agent_id 可选校验查询任意 Agent 任务，默认返回低上下文 Review Package",
    agentGetTask.schema.shape,
    async (params) => {
      const result = await agentGetTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "agent_wait_task",
    "低 Token 等待任意 Agent 任务完成，完成后返回受限审查摘要",
    agentWaitTask.schema.shape,
    async (params) => {
      const result = await agentWaitTask.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_token_status",
    "查询 Token 预算使用情况",
    tokenStatus.schema.shape,
    async (params) => {
      const result = await tokenStatus.handler(params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "mimo_delete_task",
    "永久删除已结束且没有 Worktree 的任务及其运行时文件",
    deleteTask.schema.shape,
    async (params) => {
      const result = await deleteTask.handler(params);
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
