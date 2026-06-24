import { TaskStore } from "../../../src/services/task-store.js";
import { createCancelTaskHandler } from "../../../src/tools/cancel-task.js";
import { createFinishTaskHandler } from "../../../src/tools/finish-task.js";
import { createGetTaskHandler } from "../../../src/tools/get-task.js";
import { createListTasksHandler } from "../../../src/tools/list-tasks.js";
import { createMergeTaskHandler } from "../../../src/tools/merge-task.js";
import { createReplyTaskHandler } from "../../../src/tools/reply-task.js";
import { createStartTaskHandler } from "../../../src/tools/start-task.js";
import { createTokenStatusHandler } from "../../../src/tools/token-status.js";
import { createDeleteTaskHandler } from "../../../src/tools/delete-task.js";
import { createWaitTaskHandler } from "../../../src/tools/wait-task.js";
import { createPendingReviewsHandler } from "../../../src/tools/pending-reviews.js";
import { createAgentRegistry } from "../../../src/services/agent-registry.js";
import { createAgentListHandler } from "../../../src/tools/agent-list.js";
import { createAgentStartTaskHandler } from "../../../src/tools/agent-start-task.js";
import { createAgentReplyTaskHandler } from "../../../src/tools/agent-reply-task.js";
import { createAgentGetTaskHandler } from "../../../src/tools/agent-get-task.js";
import { createAgentWaitTaskHandler } from "../../../src/tools/agent-wait-task.js";
import type { DaemonConfig } from "./daemon-config.js";

type UnavailableHandler = {
  schema: { parse: (input: unknown) => unknown; shape: Record<string, never> };
  handler: (input: unknown) => Promise<{ error: string; details?: unknown }>;
};

export interface ToolContext {
  taskStore: TaskStore;
  degraded: boolean;
  configError: string | null;
  tools: {
    startTask: ReturnType<typeof createStartTaskHandler> | UnavailableHandler;
    agentStartTask: ReturnType<typeof createAgentStartTaskHandler> | UnavailableHandler;
    agentReplyTask: ReturnType<typeof createAgentReplyTaskHandler> | UnavailableHandler;
    agentGetTask: ReturnType<typeof createAgentGetTaskHandler>;
    agentWaitTask: ReturnType<typeof createAgentWaitTaskHandler>;
    getTask: ReturnType<typeof createGetTaskHandler>;
    waitTask: ReturnType<typeof createWaitTaskHandler>;
    pendingReviews: ReturnType<typeof createPendingReviewsHandler>;
    agentList: ReturnType<typeof createAgentListHandler>;
    replyTask: ReturnType<typeof createReplyTaskHandler> | UnavailableHandler;
    cancelTask: ReturnType<typeof createCancelTaskHandler>;
    finishTask: ReturnType<typeof createFinishTaskHandler>;
    listTasks: ReturnType<typeof createListTasksHandler>;
    mergeTask: ReturnType<typeof createMergeTaskHandler>;
    tokenStatus: ReturnType<typeof createTokenStatusHandler>;
    deleteTask: ReturnType<typeof createDeleteTaskHandler>;
  };
}

export function createToolContext(config: DaemonConfig): ToolContext {
  const taskStore = new TaskStore(config.runtimeDir);
  const getTask = createGetTaskHandler(taskStore);
  const waitTask = createWaitTaskHandler(taskStore);
  const pendingReviews = createPendingReviewsHandler(taskStore);
  const agentRegistry = createAgentRegistry({
    agents: config.agents,
    mcpConfig: config.mcpConfig,
    mimoVersion: config.mimoVersion,
  });
  const agentList = createAgentListHandler(agentRegistry);
  const agentGetTask = createAgentGetTaskHandler(taskStore);
  const agentWaitTask = createAgentWaitTaskHandler(taskStore);
  const cancelTask = createCancelTaskHandler(taskStore);
  const finishTask = createFinishTaskHandler(taskStore);
  const listTasks = createListTasksHandler(taskStore);
  const mergeTask = createMergeTaskHandler(taskStore, { runtimeDir: config.runtimeDir });
  const tokenStatus = createTokenStatusHandler();
  const deleteTask = createDeleteTaskHandler(taskStore);

  const unavailable = createUnavailableHandler(config.configError ?? "MiMo 配置不可用");

  return {
    taskStore,
    degraded: config.mcpConfig === null,
    configError: config.configError,
    tools: {
      startTask: config.mcpConfig ? createStartTaskHandler(config.mcpConfig, taskStore) : unavailable,
      agentStartTask: config.mcpConfig ? createAgentStartTaskHandler(config.mcpConfig, config.agents, taskStore) : unavailable,
      agentReplyTask: config.mcpConfig ? createAgentReplyTaskHandler(config.mcpConfig, config.agents, taskStore) : unavailable,
      agentGetTask,
      agentWaitTask,
      getTask,
      waitTask,
      pendingReviews,
      agentList,
      replyTask: config.mcpConfig ? createReplyTaskHandler(config.mcpConfig, taskStore) : unavailable,
      cancelTask,
      finishTask,
      listTasks,
      mergeTask,
      tokenStatus,
      deleteTask,
    },
  };
}

function createUnavailableHandler(error: string): UnavailableHandler {
  return {
    schema: {
      shape: {},
      parse: (input: unknown) => input,
    },
    handler: async () => ({
      error,
      details: "请设置 MIMO_NODE_PATH、MIMO_ENTRY_PATH 和 MIMO_ALLOWED_ROOTS 后重启本地守护进程。",
    }),
  };
}
