import { readFileSync } from "node:fs";

const args = process.argv.slice(2);

const sessionId = "ses_fake_" + Math.random().toString(36).slice(2, 10);

let isContinue = false;
let fileContent = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session" && args[i + 1]) {
    isContinue = true;
    i++;
  }
  if (args[i] === "--file" && args[i + 1]) {
    try {
      fileContent = readFileSync(args[i + 1], "utf-8");
    } catch {
      // ignore
    }
    i++;
  }
}

if (!args.includes("run")) {
  process.stderr.write("错误: 缺少 run 命令\n");
  process.exit(1);
}

if (!args.includes("--format") || !args.includes("json")) {
  process.stderr.write("错误: 缺少 --format json 参数\n");
  process.exit(1);
}

const events = [];

events.push({
  type: "step_start",
  timestamp: Date.now(),
  sessionID: sessionId,
  part: {
    id: "prt_step_start",
    messageID: "msg_001",
    sessionID: sessionId,
    type: "step-start",
  },
});

const responseText = isContinue
  ? `收到回复，正在处理。\n\n会话 ID: ${sessionId}`
  : `收到任务说明，开始执行。\n\n任务内容摘要: ${fileContent.slice(0, 100)}...\n\n会话 ID: ${sessionId}`;

events.push({
  type: "text",
  timestamp: Date.now(),
  sessionID: sessionId,
  part: {
    id: "prt_text_001",
    messageID: "msg_001",
    sessionID: sessionId,
    type: "text",
    text: responseText,
    time: {
      start: Date.now(),
      end: Date.now() + 100,
    },
  },
});

events.push({
  type: "step_finish",
  timestamp: Date.now(),
  sessionID: sessionId,
  part: {
    id: "prt_step_finish",
    reason: "stop",
    messageID: "msg_001",
    sessionID: sessionId,
    type: "step-finish",
    tokens: {
      total: 100,
      input: 50,
      output: 50,
      reasoning: 0,
      cache: { write: 0, read: 0 },
    },
    cost: 0.001,
  },
});

for (const event of events) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

process.exit(0);
