#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientPath = join(__dirname, "mimo-bridge-client.mjs");

const DEFAULT_LIMIT = "5";
const DEFAULT_MAX_CHARS = "8000";

function runClient(args) {
  const result = spawnSync(process.execPath, [clientPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.status !== 0) {
    return {
      ok: false,
      error: stdout || stderr || `client exited with code ${result.status}`,
    };
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      error: "client returned non-JSON output",
    };
  }
}

function summarizeTask(task) {
  return {
    task_id: task.task_id,
    agent: task.agent,
    status: task.status,
    changed_files_count: task.changed_files_count,
    risk_flags: task.risk_flags || [],
    review_recommendation: task.review_recommendation,
    review_command: task.review_command,
  };
}

function main() {
  const limit = process.argv.includes("--limit")
    ? process.argv[process.argv.indexOf("--limit") + 1] || DEFAULT_LIMIT
    : DEFAULT_LIMIT;
  const maxChars = process.argv.includes("--max-chars")
    ? process.argv[process.argv.indexOf("--max-chars") + 1] || DEFAULT_MAX_CHARS
    : DEFAULT_MAX_CHARS;

  const mimo = runClient(["recover", "--limit", limit, "--max-chars", maxChars]);
  const reasonix = runClient(["agent-recover", "--agent-id", "reasonix-tui", "--limit", limit, "--max-chars", maxChars]);

  const tasks = [
    ...((mimo.ok && Array.isArray(mimo.tasks)) ? mimo.tasks : []),
    ...((reasonix.ok && Array.isArray(reasonix.tasks)) ? reasonix.tasks : []),
  ];
  const uniqueTasks = [];
  const seen = new Set();
  for (const task of tasks) {
    if (!task?.task_id || seen.has(task.task_id)) continue;
    seen.add(task.task_id);
    uniqueTasks.push(summarizeTask(task));
  }

  const firstTask = uniqueTasks[0];
  const body = {
    ok: Boolean(mimo.ok || reasonix.ok),
    operation: "review-wakeup",
    pending_count: uniqueTasks.length,
    tasks: uniqueTasks,
    next_review_command: firstTask?.review_command || null,
    commands: {
      mimo_recover: "node scripts\\mimo-bridge-client.mjs recover --limit 5 --max-chars 8000",
      reasonix_recover: "node scripts\\mimo-bridge-client.mjs agent-recover --agent-id reasonix-tui --limit 5 --max-chars 8000",
    },
    errors: [mimo, reasonix].filter((item) => !item.ok).map((item) => item.error),
  };

  process.stdout.write(`${JSON.stringify(body)}\n`);
  process.exit(body.ok ? 0 : 1);
}

main();

