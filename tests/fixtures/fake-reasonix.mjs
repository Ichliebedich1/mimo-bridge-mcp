import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (process.env.FAKE_REASONIX_ARGS_PATH) {
  writeFileSync(process.env.FAKE_REASONIX_ARGS_PATH, JSON.stringify(args, null, 2), "utf-8");
}

if (args[0] === "version") {
  console.log("reasonix fake-test");
  process.exit(0);
}

if (args[0] === "doctor" && args[1] === "--json") {
  console.log(JSON.stringify({
    config: { default_model: "fake-model" },
    providers: [
      {
        name: "fake",
        kind: "openai",
        models: ["fake-model"],
        key_present: true,
        is_default: true,
        context_window: 100000
      }
    ],
    sessions: { dir: process.env.REASONIX_HOME + "/sessions", count: 0, bytes: 0 },
    permission: { mode: "ask" },
    sandbox: { available: false },
    warnings: []
  }));
  process.exit(0);
}

if (args[0] !== "run") {
  console.error("unsupported fake reasonix command");
  process.exit(2);
}

const resumeIndex = args.indexOf("--resume");
const resumePath = resumeIndex >= 0 ? args[resumeIndex + 1] : "";
const taskText = args[args.length - 1] || "";
const match = /任务说明文件并完成任务:\s*(.+)$/mu.exec(taskText);
if (!match) {
  console.error("missing task brief path");
  process.exit(1);
}

if (!taskText.includes("当前工作目录就是目标项目目录")) {
  console.error("missing workspace orientation");
  process.exit(1);
}

const briefPath = match[1].trim();
const brief = readFileSync(briefPath, "utf-8");
if (!brief.includes("# ")) {
  console.error("invalid task brief");
  process.exit(1);
}

mkdirSync("src", { recursive: true });
if (resumePath) {
  writeFileSync(join("src", "reasonix-followup.txt"), `Reasonix fake resumed from ${resumePath}\n`, "utf-8");
} else {
  writeFileSync(join("src", "reasonix-output.txt"), "Reasonix fake task completed\n", "utf-8");
}
writeFakeSession(taskText);
console.log("Reasonix fake received task brief.");
console.log(resumePath ? "Reasonix fake resumed previous session." : "Reasonix fake wrote src/reasonix-output.txt.");
process.exit(0);

function writeFakeSession(taskText) {
  if (!process.env.REASONIX_HOME) {
    return;
  }
  const projectName = process.cwd().replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const sessionsDir = join(process.env.REASONIX_HOME, "projects", projectName, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const taskId = /task_[a-f0-9]{12}/i.exec(taskText)?.[0] || "task_unknown";
  const sessionPath = join(sessionsDir, `20260625-000000.000000000-fake-${taskId}.jsonl`);
  const event = {
    type: "message",
    task_id: taskId,
    text: "fake Reasonix session",
  };
  if (process.env.FAKE_REASONIX_USAGE === "1") {
    event.usage = {
      prompt_tokens: 21,
      completion_tokens: 9,
      total_tokens: 30,
    };
    event.cost = 0.0007;
  }
  writeFileSync(sessionPath, JSON.stringify(event) + "\n", "utf-8");
  writeFileSync(sessionPath + ".meta", JSON.stringify({ task_id: taskId }) + "\n", "utf-8");
}
