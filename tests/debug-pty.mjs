import * as pty from "node-pty";

const mimoNodePath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node.exe";
const mimoEntryPath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node_modules\\@mimo-ai\\cli\\bin\\mimo";
const workspacePath = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\debug-mcp\\workspace";
const briefPath = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\debug-mcp\\briefs\\task_fc744d59714d-round-1.md";

const args = [
  mimoEntryPath,
  "run",
  "--pure",
  "--dangerously-skip-permissions",
  "--dir", workspacePath,
  "--format", "json",
  "请读取附件中的任务说明并按要求执行。",
  "--file", briefPath,
];

console.log("Spawning MiMo with PTY...");
console.log("Node:", mimoNodePath);
console.log("Args:", JSON.stringify(args, null, 2));

const ptyProcess = pty.spawn(mimoNodePath, args, {
  name: "xterm-256color",
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env,
});

console.log("PTY PID:", ptyProcess.pid);

ptyProcess.onData((data) => {
  console.log("STDOUT:", data);
});

ptyProcess.onExit(({ exitCode, signal }) => {
  console.log("Process exited with code:", exitCode, "signal:", signal);
  process.exit(0);
});

setTimeout(() => {
  console.log("Timeout reached, killing process");
  ptyProcess.kill();
  process.exit(1);
}, 15000);
