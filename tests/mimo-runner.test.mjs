import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMimoArgs,
  resolveMimoCliModel,
  resolveMimoCliVariant,
} from "../dist/services/mimo-runner.js";

function makeTask(routing) {
  return {
    task_id: "task_modeltest",
    current_round: 1,
    session_id: null,
    config: {
      workspace_path: "C:\\workspace\\project",
      routing,
    },
  };
}

test("resolveMimoCliModel maps Bridge model labels to MiMo CLI provider/model names", () => {
  assert.equal(resolveMimoCliModel("mimo-v2.5-flash"), "xiaomi/mimo-v2.5");
  assert.equal(resolveMimoCliModel("mimo-v2.5-pro"), "xiaomi/mimo-v2.5-pro");
  assert.equal(resolveMimoCliModel("mimo-v2.5-pro-ultra-speed"), "xiaomi/mimo-v2.5-pro-ultra-speed");
  assert.equal(resolveMimoCliModel("unknown-model"), null);
  assert.equal(resolveMimoCliModel(undefined), null);
});

test("resolveMimoCliVariant maps Bridge reasoning effort to MiMo variant names", () => {
  assert.equal(resolveMimoCliVariant("low"), "minimal");
  assert.equal(resolveMimoCliVariant("medium"), "high");
  assert.equal(resolveMimoCliVariant("high"), "max");
  assert.equal(resolveMimoCliVariant(undefined), null);
});

test("buildMimoArgs passes provider/model and variant to the MiMo CLI", () => {
  const args = buildMimoArgs(makeTask({
    model: "mimo-v2.5-pro",
    reasoning_effort: "high",
  }), "C:/runtime");

  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "xiaomi/mimo-v2.5-pro",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--variant"), args.indexOf("--variant") + 2), [
    "--variant",
    "max",
  ]);
});

test("buildMimoArgs passes ultra-speed provider/model to the MiMo CLI", () => {
  const args = buildMimoArgs(makeTask({
    model: "mimo-v2.5-pro-ultra-speed",
    reasoning_effort: "high",
  }), "C:/runtime");

  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "xiaomi/mimo-v2.5-pro-ultra-speed",
  ]);
});
