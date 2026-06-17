const line = '[2J[m[H]0;D:\\AI\\Mimo2 Codex\\.tools\\node-v22.22.3-win-x64\\node.exe[?25h{"type":"step_start","timestamp":1781713334249,"sessionID":"ses_1299c1de2ffeRq9gs5jBEUnZUf","part":{"id":"prt_ed663efe7001uCO5XLYdiKUPyQ","messageID":"msg_ed663e660001P1p0o03LTnMAQk","sessionID":"ses_1299c1de2ffeRq9gs5jBEUnZUf","snapshot":"4b825dc642cb6eb9a060e54bf8d69288fbee4904","type":"step-start"}}[K';

console.log("Original line length:", line.length);
console.log("First 100 chars:", line.substring(0, 100));
console.log("Contains {:", line.includes("{"));
console.log("{ index:", line.indexOf("{"));

// 简单的方法：找到第一个 { 和最后一个 }
const start = line.indexOf("{");
const end = line.lastIndexOf("}");

if (start !== -1 && end !== -1 && end > start) {
  const json = line.substring(start, end + 1);
  console.log("Extracted JSON:", json.substring(0, 100) + "...");
  
  try {
    const event = JSON.parse(json);
    console.log("Parsed sessionID:", event.sessionID);
  } catch (e) {
    console.log("Parse error:", e.message);
  }
} else {
  console.log("No JSON found");
}
