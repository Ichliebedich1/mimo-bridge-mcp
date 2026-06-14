import { readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);

let isContinue = false;
let sessionIdArg = null;
let fileArg = null;
let dirArg = null;
let fileContent = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session" && args[i + 1]) {
    isContinue = true;
    sessionIdArg = args[i + 1];
    i++;
  }
  if (args[i] === "--file" && args[i + 1]) {
    fileArg = args[i + 1];
    i++;
  }
  if (args[i] === "--dir" && args[i + 1]) {
    dirArg = args[i + 1];
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

if (!fileArg) {
  process.stderr.write("错误: 缺少 --file 参数\n");
  process.exit(1);
}

if (!dirArg) {
  process.stderr.write("错误: 缺少 --dir 参数\n");
  process.exit(1);
}

if (!existsSync(fileArg)) {
  process.stderr.write(`错误: 任务说明文件不存在: ${fileArg}\n`);
  process.exit(1);
}

try {
  fileContent = readFileSync(fileArg, "utf-8");
  if (!fileContent.includes("# 任务说明")) {
    process.stderr.write("错误: 任务说明文件缺少 '# 任务说明' 标记\n");
    process.exit(1);
  }
} catch {
  process.stderr.write(`错误: 无法读取任务说明文件: ${fileArg}\n`);
  process.exit(1);
}

if (isContinue && !sessionIdArg) {
  process.stderr.write("错误: 续接任务缺少有效的 --session 参数\n");
  process.exit(1);
}

const sessionId = isContinue && sessionIdArg ? sessionIdArg : "ses_fake_" + Math.random().toString(36).slice(2, 10);

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
