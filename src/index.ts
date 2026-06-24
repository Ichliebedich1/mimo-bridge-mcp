import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { createAgentCancelTaskHandler } from "./tools/agent-cancel-task.js";
import { createAgentFinishTaskHandler } from "./tools/agent-finish-task.js";
import { createAgentMergeTaskHandler } from "./tools/agent-merge-task.js";
import { createAgentDeleteTaskHandler } from "./tools/agent-delete-task.js";
import { createAgentQueueStatusHandler } from "./tools/agent-queue-status.js";
import { createAgentListTasksHandler } from "./tools/agent-list-tasks.js";

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
  const agentCancelTask = createAgentCancelTaskHandler(taskStore);
  const agentFinishTask = createAgentFinishTaskHandler(taskStore);
  const agentMergeTask = createAgentMergeTaskHandler(taskStore, config);
  const agentDeleteTask = createAgentDeleteTaskHandler(taskStore);
  const agentListTasks = createAgentListTasksHandler(taskStore);
  const agentPendingReviews = createPendingReviewsHandler(taskStore);
  const agentQueueStatus = createAgentQueueStatusHandler({
    getQueueStatus: () => startTask.getQueueStatus(),
  });
  const replyTask = createReplyTaskHandler(config, taskStore);
  const cancelTask = createCancelTaskHandler(taskStore);
  const finishTask = createFinishTaskHandler(taskStore);
  const listTasks = createListTasksHandler(taskStore);
  const mergeTask = createMergeTaskHandler(taskStore, config);
  const tokenStatus = createTokenStatusHandler();
  const deleteTask = createDeleteTaskHandler(taskStore);

  registerJsonTool(server, "mimo_start_task", "Create and start a MiMo task", startTask);
  registerJsonTool(server, "mimo_get_task", "Read a MiMo task with bounded detail levels", getTask);
  registerJsonTool(server, "mimo_wait_task", "Low-token wait for a MiMo task", waitTask);
  registerJsonTool(server, "mimo_reply_task", "Reply to an existing MiMo task", replyTask);
  registerJsonTool(server, "mimo_cancel_task", "Cancel a queued or running MiMo task", cancelTask);
  registerJsonTool(server, "mimo_finish_task", "Mark a MiMo task as accepted or abandoned", finishTask);
  registerJsonTool(server, "mimo_list_tasks", "List recent tasks", listTasks);
  registerJsonTool(server, "mimo_pending_reviews", "List completed tasks waiting for Codex review", pendingReviews);
  registerJsonTool(server, "mimo_merge_task", "Merge or discard a task Worktree", mergeTask);

  registerJsonTool(server, "agent_list", "List configured execution agents", agentList);
  registerJsonTool(server, "agent_start_task", "Create and start a task with a selected agent", agentStartTask);
  registerJsonTool(server, "agent_reply_task", "Reply to a task owned by a selected agent", agentReplyTask);
  registerJsonTool(server, "agent_get_task", "Read any agent task with bounded detail levels", agentGetTask);
  registerJsonTool(server, "agent_wait_task", "Low-token wait for any agent task", agentWaitTask);
  registerJsonTool(server, "agent_list_tasks", "List recent tasks with bounded agent-safe summaries", agentListTasks);
  registerJsonTool(server, "agent_pending_reviews", "List completed agent tasks waiting for Codex review", agentPendingReviews);
  registerJsonTool(server, "agent_cancel_task", "Cancel a queued or running task for any supported agent", agentCancelTask);
  registerJsonTool(server, "agent_finish_task", "Mark any supported agent task as accepted or abandoned", agentFinishTask);
  registerJsonTool(server, "agent_merge_task", "Merge or discard any supported agent task Worktree", agentMergeTask);
  registerJsonTool(server, "agent_delete_task", "Delete a terminal agent task after its Worktree is gone", agentDeleteTask);
  registerJsonTool(server, "agent_queue_status", "Show the shared task queue, optionally filtered by agent_id", agentQueueStatus);

  server.tool("mimo_queue_status", "Show the shared task queue", {}, async () => {
    const result = startTask.getQueueStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  });

  registerJsonTool(server, "mimo_token_status", "Show token budget status", tokenStatus);
  registerJsonTool(server, "mimo_delete_task", "Delete a terminal task after its Worktree is gone", deleteTask);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("mimo-bridge-mcp-server started\n");
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

main().catch((err) => {
  process.stderr.write(`Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
