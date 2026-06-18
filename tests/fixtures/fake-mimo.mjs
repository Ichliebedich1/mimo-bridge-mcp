import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);

const scenario = process.env.FAKE_MIMO_SCENARIO || "success";

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

if (scenario === "no_session") {
  process.stdout.write(JSON.stringify({ type: "text", timestamp: Date.now(), part: { text: "No session" } }) + "\n");
  process.exit(0);
} else if (scenario === "exit_error") {
  process.stderr.write("错误: 模拟退出错误\n");
  process.exit(1);
} else if (scenario === "timeout") {
  setInterval(() => {}, 1000);
} else if (scenario === "cancel") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    shell: false,
    stdio: "ignore",
  });
  child.unref();
  setInterval(() => {}, 1000);
} else if (scenario === "stderr") {
  process.stderr.write("警告: 这是一个警告\n");
  outputEvents(sessionId);
} else if (scenario === "malformed") {
  process.stdout.write("这不是JSON\n");
  outputEvents(sessionId);
} else if (scenario === "fragmented") {
  const event = JSON.stringify({
    type: "text",
    timestamp: Date.now(),
    sessionID: sessionId,
    part: {
      id: "prt_text_001",
      messageID: "msg_001",
      sessionID: sessionId,
      type: "text",
      text: "碎片化输出测试",
    },
  });

  for (let i = 0; i < event.length; i += 10) {
    process.stdout.write(event.slice(i, i + 10));
  }
  process.stdout.write("\n");
  process.exit(0);
} else {
  outputEvents(sessionId);
}

function outputEvents(sid) {
  const events = [];

  events.push({
    type: "step_start",
    timestamp: Date.now(),
    sessionID: sid,
    part: {
      id: "prt_step_start",
      messageID: "msg_001",
      sessionID: sid,
      type: "step-start",
    },
  });

  const responseText = isContinue
    ? `收到回复，正在处理。\n\n会话 ID: ${sid}`
    : `收到任务说明，开始执行。\n\n任务内容摘要: ${fileContent.slice(0, 100)}...\n\n会话 ID: ${sid}`;

  events.push({
    type: "text",
    timestamp: Date.now(),
    sessionID: sid,
    part: {
      id: "prt_text_001",
      messageID: "msg_001",
      sessionID: sid,
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
    sessionID: sid,
    part: {
      id: "prt_step_finish",
      reason: "stop",
      messageID: "msg_001",
      sessionID: sid,
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
}
