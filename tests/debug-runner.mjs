import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";

const mimoNodePath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node.exe";
const mimoEntryPath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node_modules\\@mimo-ai\\cli\\bin\\mimo";
const workspacePath = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\debug-test\\workspace";
const briefPath = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\debug-test\briefs\\task_debug-round-1.md";

const args = [
  mimoEntryPath,
  "run",
  "--dir", workspacePath,
  "--format", "json",
  "请读取附件中的任务说明并按要求执行。",
  "--file", briefPath,
];

console.log("Spawning MiMo...");
console.log("Node:", mimoNodePath);
console.log("Args:", JSON.stringify(args, null, 2));

const proc = spawn(mimoNodePath, args, {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
  windowsHide: true,
});

console.log("Process PID:", proc.pid);

proc.stdout?.on("data", (data) => {
  console.log("STDOUT:", data.toString());
});

proc.stderr?.on("data", (data) => {
  console.log("STDERR:", data.toString());
});

proc.on("close", (code) => {
  console.log("Process closed with code:", code);
  process.exit(0);
});

proc.on("error", (err) => {
  console.log("Process error:", err.message);
  process.exit(1);
});

proc.on("spawn", () => {
  console.log("Process spawned successfully");
});

setTimeout(() => {
  console.log("Timeout reached, killing process");
  proc.kill();
  process.exit(1);
}, 15000);
