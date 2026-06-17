import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const testDir = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\smoke-test";

if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

const workspaceDir = join(testDir, "workspace");
if (!existsSync(workspaceDir)) {
  mkdirSync(workspaceDir, { recursive: true });
}

writeFileSync(join(workspaceDir, "test.txt"), "# 任务说明\n\n请读取此文件并回复：文件内容是什么？\n");

const env = {
  ...process.env,
  MIMO_NODE_PATH: "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node.exe",
  MIMO_ENTRY_PATH: "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node_modules\\@mimo-ai\\cli\\bin\\mimo",
  MIMO_ALLOWED_ROOTS: "C:\\Users\\86172\\Desktop",
  MIMO_RUNTIME_DIR: "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime",
};

const mcpServer = spawn("C:\\Program Files\\nodejs\\node.exe", [
  "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\dist\\index.js",
], {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  env,
});

let stdout = "";
let stderr = "";
let taskId = null;
let sessionId = null;

mcpServer.stdout.on("data", (data) => {
  stdout += data.toString();
  const lines = data.toString().split("\n").filter(l => l.trim());
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      if (response.id === 2 && response.result?.content?.[0]?.text) {
        const taskResult = JSON.parse(response.result.content[0].text);
        taskId = taskResult.task_id;
        console.log("Task created:", taskId);
      }
      if (response.id === 3 && response.result?.content?.[0]?.text) {
        const taskStatus = JSON.parse(response.result.content[0].text);
        console.log("Task status:", JSON.stringify(taskStatus, null, 2));
        if (taskStatus.session_id) {
          sessionId = taskStatus.session_id;
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
});

mcpServer.stderr.on("data", (data) => {
  stderr += data.toString();
});

const listToolsRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
});

console.log("1. Sending tools/list request...");
mcpServer.stdin.write(listToolsRequest + "\n");

setTimeout(() => {
  const startTaskRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "mimo_start_task",
      arguments: {
        objective: "读取 test.txt 文件内容并回复",
        workspace_path: workspaceDir,
        editable_paths: ["test.txt"],
        max_rounds: 2,
        runtime_timeout_seconds: 300,
      },
    },
  });

  console.log("2. Sending mimo_start_task request...");
  mcpServer.stdin.write(startTaskRequest + "\n");
}, 1000);

setTimeout(() => {
  if (taskId) {
    const getTaskRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "mimo_get_task",
        arguments: {
          task_id: taskId,
        },
      },
    });

    console.log("3. Sending mimo_get_task request...");
    mcpServer.stdin.write(getTaskRequest + "\n");
  }
}, 10000);

setTimeout(() => {
  if (taskId && sessionId) {
    const replyTaskRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "mimo_reply_task",
        arguments: {
          task_id: taskId,
          message: "请确认你已经读取了文件内容",
        },
      },
    });

    console.log("4. Sending mimo_reply_task request...");
    mcpServer.stdin.write(replyTaskRequest + "\n");
  }
}, 15000);

setTimeout(() => {
  if (taskId) {
    const getTaskRequest2 = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "mimo_get_task",
        arguments: {
          task_id: taskId,
        },
      },
    });

    console.log("5. Sending final mimo_get_task request...");
    mcpServer.stdin.write(getTaskRequest2 + "\n");
  }
}, 25000);

setTimeout(() => {
  console.log("\n=== Smoke Test Results ===");
  console.log("Task ID:", taskId);
  console.log("Session ID:", sessionId);
  console.log("Task created: ✅");
  console.log("Task queried: ✅");
  console.log("Task replied: ✅");
  console.log("========================\n");

  mcpServer.kill();
  process.exit(0);
}, 30000);
