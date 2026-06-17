import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const testDir = "C:\\Users\\86172\\Desktop\\MiMo Code project\\Agent 协作项目\\mimo-bridge-mcp\\runtime\\debug-test";

if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

const workspaceDir = join(testDir, "workspace");
const briefsDir = join(testDir, "briefs");
const logsDir = join(testDir, "logs");

if (!existsSync(workspaceDir)) mkdirSync(workspaceDir, { recursive: true });
if (!existsSync(briefsDir)) mkdirSync(briefsDir, { recursive: true });
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });

const briefPath = join(briefsDir, "task_debug-round-1.md");
writeFileSync(briefPath, "# 任务说明\n\n请读取此文件并回复：文件内容是什么？\n");

const workspacePath = join(workspaceDir, "test.txt");
writeFileSync(workspacePath, "这是一个测试文件\n");

const mimoNodePath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node.exe";
const mimoEntryPath = "D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node_modules\\@mimo-ai\\cli\\bin\\mimo";

console.log("=== MiMo Direct Execution Debug ===");
console.log("Node path:", mimoNodePath);
console.log("Entry path:", mimoEntryPath);
console.log("Brief path:", briefPath);
console.log("Workspace path:", workspaceDir);
console.log("");

const args = [
  mimoEntryPath,
  "run",
  "--file", briefPath,
  "--dir", workspaceDir,
  "--format", "json",
  "请读取附件中的任务说明并按要求执行。",
];

console.log("Command:", mimoNodePath);
console.log("Args:", args.join(" "));
console.log("");

const proc = spawn(mimoNodePath, args, {
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let stdout = "";
let stderr = "";

proc.stdout.on("data", (data) => {
  const chunk = data.toString();
  stdout += chunk;
  console.log("STDOUT:", chunk);
});

proc.stderr.on("data", (data) => {
  const chunk = data.toString();
  stderr += chunk;
  console.log("STDERR:", chunk);
});

proc.on("close", (code) => {
  console.log("");
  console.log("=== Process Completed ===");
  console.log("Exit code:", code);
  console.log("Stdout length:", stdout.length);
  console.log("Stderr length:", stderr.length);
  
  if (stdout) {
    console.log("");
    console.log("=== Stdout Content ===");
    console.log(stdout);
  }
  
  if (stderr) {
    console.log("");
    console.log("=== Stderr Content ===");
    console.log(stderr);
  }
  
  process.exit(0);
});

proc.on("error", (err) => {
  console.log("");
  console.log("=== Process Error ===");
  console.log("Error:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("");
  console.log("=== Timeout - Killing Process ===");
  proc.kill();
  process.exit(1);
}, 30000);
