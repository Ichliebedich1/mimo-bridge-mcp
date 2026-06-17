import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const testDir = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\smoke-test";

if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

const workspaceDir = join(testDir, "workspace");
if (!existsSync(workspaceDir)) {
  mkdirSync(workspaceDir, { recursive: true });
}

writeFileSync(join(workspaceDir, "test.txt"), "这是一个测试文件\n");

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

mcpServer.stdout.on("data", (data) => {
  stdout += data.toString();
  console.log("STDOUT:", data.toString());
});

mcpServer.stderr.on("data", (data) => {
  stderr += data.toString();
  console.log("STDERR:", data.toString());
});

const listToolsRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: {},
});

console.log("Sending tools/list request...");
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

  console.log("Sending mimo_start_task request...");
  mcpServer.stdin.write(startTaskRequest + "\n");
}, 2000);

setTimeout(() => {
  console.log("Test completed. Shutting down...");
  mcpServer.kill();
  process.exit(0);
}, 30000);
