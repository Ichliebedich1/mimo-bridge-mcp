import { describe, it } from "node:test";
import assert from "node:assert";
import { createEventParser } from "../dist/services/event-parser.js";

describe("event-parser", () => {
  it("should parse valid JSONL events", () => {
    const parser = createEventParser();

    const jsonl = [
      JSON.stringify({
        type: "step_start",
        timestamp: Date.now(),
        sessionID: "ses_test123",
        part: { id: "prt1", messageID: "msg1", sessionID: "ses_test123", type: "step-start" },
      }),
      JSON.stringify({
        type: "text",
        timestamp: Date.now(),
        sessionID: "ses_test123",
        part: { id: "prt2", messageID: "msg1", sessionID: "ses_test123", type: "text", text: "Hello" },
      }),
      JSON.stringify({
        type: "step_finish",
        timestamp: Date.now(),
        sessionID: "ses_test123",
        part: { id: "prt3", messageID: "msg1", sessionID: "ses_test123", type: "step-finish", reason: "stop" },
      }),
    ].join("\n") + "\n";

    const result = parser.parse(jsonl);

    assert.strictEqual(result.sessionId, "ses_test123");
    assert.strictEqual(result.textChunks.length, 1);
    assert.strictEqual(result.textChunks[0], "Hello");
    assert.strictEqual(result.events.length, 3);
  });

  it("should extract sessionID from part.sessionID", () => {
    const parser = createEventParser();

    const jsonl =
      JSON.stringify({
        type: "text",
        timestamp: Date.now(),
        part: { id: "prt1", messageID: "msg1", sessionID: "ses_part456", type: "text", text: "Test" },
      }) + "\n";

    const result = parser.parse(jsonl);

    assert.strictEqual(result.sessionId, "ses_part456");
  });

  it("should handle fragmented JSON", () => {
    const parser = createEventParser();

    const event = JSON.stringify({
      type: "text",
      timestamp: Date.now(),
      sessionID: "ses_frag",
      part: { id: "prt1", messageID: "msg1", sessionID: "ses_frag", type: "text", text: "Fragmented" },
    });

    parser.parse(event.slice(0, 20));
    parser.parse(event.slice(20, 40));
    const result = parser.parse(event.slice(40) + "\n");

    assert.strictEqual(result.sessionId, "ses_frag");
    assert.strictEqual(result.textChunks[0], "Fragmented");
  });

  it("should extract PTY JSON events with ANSI control text and no newlines", () => {
    const parser = createEventParser();

    const event1 = JSON.stringify({
      type: "step_start",
      timestamp: Date.now(),
      sessionID: "ses_pty",
      part: { id: "prt1", messageID: "msg1", sessionID: "ses_pty", type: "step-start" },
    });
    const event2 = JSON.stringify({
      type: "text",
      timestamp: Date.now(),
      sessionID: "ses_pty",
      part: { id: "prt2", messageID: "msg1", sessionID: "ses_pty", type: "text", text: "PTY text" },
    });

    const esc = String.fromCharCode(27);
    const result = parser.parse(`${esc}[2J${esc}[m${esc}[H${event1}${esc}[K${event2}${esc}[?25h`);

    assert.strictEqual(result.sessionId, "ses_pty");
    assert.strictEqual(result.textChunks[0], "PTY text");
    assert.strictEqual(result.events.length, 2);
  });

  it("should recover JSON events soft-wrapped by a PTY", () => {
    const parser = createEventParser();

    const event = JSON.stringify({
      type: "text",
      timestamp: Date.now(),
      sessionID: "ses_wrapped",
      part: {
        id: "prt_wrapped",
        messageID: "msg_wrapped",
        sessionID: "ses_wrapped",
        type: "text",
        text: "Wrapped PTY text",
      },
    });
    const esc = String.fromCharCode(27);
    const wrapped = `${esc}[2J${event.slice(0, 80)}\r\n${event.slice(80, 160)}\r\n${event.slice(160)}${esc}[K`;

    const result = parser.parse(wrapped);

    assert.strictEqual(result.sessionId, "ses_wrapped");
    assert.strictEqual(result.textChunks[0], "Wrapped PTY text");
    assert.strictEqual(result.events.length, 1);
  });

  it("should handle malformed JSON gracefully", () => {
    const parser = createEventParser();

    const jsonl = [
      "这不是JSON",
      JSON.stringify({
        type: "text",
        timestamp: Date.now(),
        sessionID: "ses_malformed",
        part: { id: "prt1", messageID: "msg1", sessionID: "ses_malformed", type: "text", text: "Valid" },
      }),
    ].join("\n") + "\n";

    const result = parser.parse(jsonl);

    assert.strictEqual(result.sessionId, "ses_malformed");
    assert.strictEqual(result.textChunks[0], "Valid");
    assert.strictEqual(result.rawLines.length, 2);
  });

  it("should flush buffer on end", () => {
    const parser = createEventParser();

    const event = JSON.stringify({
      type: "text",
      timestamp: Date.now(),
      sessionID: "ses_flush",
      part: { id: "prt1", messageID: "msg1", sessionID: "ses_flush", type: "text", text: "Flushed" },
    });

    parser.parse(event);

    const result = parser.flush();

    assert.strictEqual(result.sessionId, "ses_flush");
    assert.strictEqual(result.textChunks[0], "Flushed");
  });

  it("should handle last event without newline", () => {
    const parser = createEventParser();

    const event1 = JSON.stringify({
      type: "step_start",
      timestamp: Date.now(),
      sessionID: "ses_no_newline",
      part: { id: "prt1", messageID: "msg1", sessionID: "ses_no_newline", type: "step-start" },
    }) + "\n";

    const event2 = JSON.stringify({
      type: "text",
      timestamp: Date.now(),
      sessionID: "ses_no_newline",
      part: { id: "prt2", messageID: "msg1", sessionID: "ses_no_newline", type: "text", text: "No Newline" },
    });

    parser.parse(event1);
    parser.parse(event2);

    const result = parser.flush();

    assert.strictEqual(result.sessionId, "ses_no_newline");
    assert.strictEqual(result.textChunks[0], "No Newline");
    assert.strictEqual(result.events.length, 2);
  });

  it("should extract questions from text", () => {
    const parser = createEventParser();

    const jsonl =
      JSON.stringify({
        type: "text",
        timestamp: Date.now(),
        sessionID: "ses_q",
        part: {
          id: "prt1",
          messageID: "msg1",
          sessionID: "ses_q",
          type: "text",
          text: "已完成基础功能。请问是否需要锁定账户？登录失败5次后是否锁定？",
        },
      }) + "\n";

    const result = parser.parse(jsonl);
    const questions = parser.extractQuestions(result);

    assert.ok(questions.length > 0);
  });
});
