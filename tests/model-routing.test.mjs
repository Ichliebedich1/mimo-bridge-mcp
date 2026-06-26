import { test } from "node:test";
import assert from "node:assert";

import {
  MIMO_MODELS,
  MIMO_ULTRA_SPEED_MODEL,
  REASONIX_MODELS,
  getRoutingProfiles,
  normalizeRoutingProfilesConfig,
  reasoningEffortToMaxSteps,
  resolveRouting,
  selectRoutingAgent,
  validateModelForAgent,
} from "../dist/services/model-routing.js";

test("routing profiles expose scenarios, models, efforts, and pricing", () => {
  const profiles = getRoutingProfiles();
  assert.strictEqual(profiles.default_scenario, "normal");
  assert.deepStrictEqual(profiles.allowed_models.mimo, [...MIMO_MODELS]);
  assert.deepStrictEqual(profiles.allowed_models["reasonix-tui"], [...REASONIX_MODELS]);
  assert.deepStrictEqual(profiles.reasoning_efforts, ["low", "medium", "high"]);
  assert.strictEqual(profiles.scenarios.multimodal.current.agent_id, "mimo");
  assert.strictEqual(profiles.scenarios.multimodal.current.model, "mimo-v2.5-flash");
  assert.strictEqual(profiles.pricing_per_1m_cny.flash.input, 1);
  assert.strictEqual(profiles.pricing_per_1m_cny.pro.output, 6);
});

test("auto routing uses configured scenario defaults", () => {
  const routingProfiles = {
    scenarios: {
      normal: {
        agent_id: "reasonix-tui",
        model: "deepseek-v4-flash",
        reasoning_effort: "low",
      },
    },
  };
  assert.strictEqual(selectRoutingAgent({ routing_mode: "auto", task_scenario: "normal" }, routingProfiles), "reasonix-tui");
  const result = resolveRouting("reasonix-tui", { routing_mode: "auto", task_scenario: "normal" }, routingProfiles);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.model, "deepseek-v4-flash");
  assert.strictEqual(result.config.reasoning_effort, "low");
  assert.match(result.config.routing_reason, /自动路由/);
});

test("manual routing respects explicit model and effort", () => {
  const result = resolveRouting("mimo", {
    routing_mode: "manual",
    task_scenario: "complex",
    model: "mimo-v2.5-pro",
    reasoning_effort: "high",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.routing_mode, "manual");
  assert.strictEqual(result.config.model, "mimo-v2.5-pro");
  assert.strictEqual(result.config.reasoning_effort, "high");
});

test("multimodal tasks force MiMo flash and reject Reasonix", () => {
  const mimo = resolveRouting("mimo", { routing_mode: "auto", has_images: true });
  assert.strictEqual(mimo.ok, true);
  assert.strictEqual(mimo.config.task_scenario, "multimodal");
  assert.strictEqual(mimo.config.model, "mimo-v2.5-flash");

  const reasonix = resolveRouting("reasonix-tui", { routing_mode: "auto", task_scenario: "multimodal" });
  assert.strictEqual(reasonix.ok, false);
  assert.match(reasonix.error, /多模态/);
});

test("model validation keeps MiMo and Reasonix model lists separate", () => {
  assert.strictEqual(validateModelForAgent("mimo", "mimo-v2.5-flash").ok, true);
  assert.strictEqual(validateModelForAgent("reasonix-tui", "deepseek-v4-pro").ok, true);
  const mimoInvalid = validateModelForAgent("mimo", "deepseek-v4-flash");
  const reasonixInvalid = validateModelForAgent("reasonix-tui", "mimo-v2.5-pro");
  assert.strictEqual(mimoInvalid.ok, false);
  assert.strictEqual(reasonixInvalid.ok, false);
  assert.match(mimoInvalid.error, /MiMo 不支持模型/);
  assert.match(reasonixInvalid.error, /Reasonix 不支持模型/);
});

test("routing profile normalization rejects invalid multimodal override", () => {
  const result = normalizeRoutingProfilesConfig({
    scenarios: {
      multimodal: {
        agent_id: "reasonix-tui",
        model: "deepseek-v4-flash",
        reasoning_effort: "low",
      },
    },
  });
  assert.strictEqual(result.ok, false);
});

test("routing profile normalization accepts UI scenario objects with current selection", () => {
  const result = normalizeRoutingProfilesConfig({
    scenarios: {
      normal: {
        description: "普通代码任务",
        current: {
          agent_id: "reasonix-tui",
          model: "deepseek-v4-flash",
          reasoning_effort: "medium",
        },
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.scenarios.normal.agent_id, "reasonix-tui");
  assert.strictEqual(result.config.scenarios.normal.model, "deepseek-v4-flash");
});

test("reasoning effort maps to Reasonix max steps", () => {
  assert.strictEqual(reasoningEffortToMaxSteps("low"), 10);
  assert.strictEqual(reasoningEffortToMaxSteps("medium"), 20);
  assert.strictEqual(reasoningEffortToMaxSteps("high"), 40);
});

test("ultra speed is disabled by default: not in allowed_models and rejected by validation", () => {
  const profiles = getRoutingProfiles();
  assert.strictEqual(profiles.allowed_models.mimo.includes(MIMO_ULTRA_SPEED_MODEL), false);
  assert.strictEqual(validateModelForAgent("mimo", MIMO_ULTRA_SPEED_MODEL).ok, false);
  assert.match(validateModelForAgent("mimo", MIMO_ULTRA_SPEED_MODEL).error, /Ultra Speed 未启用/);
});

test("ultra speed is available when enabled: in allowed_models and accepted by validation", () => {
  const config = { enable_mimo_pro_ultra_speed: true };
  const profiles = getRoutingProfiles(config);
  assert.strictEqual(profiles.allowed_models.mimo.includes(MIMO_ULTRA_SPEED_MODEL), true);
  assert.strictEqual(validateModelForAgent("mimo", MIMO_ULTRA_SPEED_MODEL, config).ok, true);
});

test("ultra speed pricing is always exposed in routing profiles", () => {
  const profiles = getRoutingProfiles();
  assert.strictEqual(profiles.pricing_per_1m_cny.ultra_speed.input, 9);
  assert.strictEqual(profiles.pricing_per_1m_cny.ultra_speed.output, 18);
  assert.strictEqual(profiles.pricing_per_1m_cny.ultra_speed.cache_hit, 0.075);
});

test("ultra speed is rejected for multimodal tasks even when enabled", () => {
  const result = resolveRouting("mimo", {
    routing_mode: "manual",
    task_scenario: "multimodal",
    model: MIMO_ULTRA_SPEED_MODEL,
    reasoning_effort: "medium",
  }, { enable_mimo_pro_ultra_speed: true });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /多模态/);
});

test("ultra speed can be selected via manual routing when enabled", () => {
  const result = resolveRouting("mimo", {
    routing_mode: "manual",
    task_scenario: "complex",
    model: MIMO_ULTRA_SPEED_MODEL,
    reasoning_effort: "high",
  }, { enable_mimo_pro_ultra_speed: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.model, MIMO_ULTRA_SPEED_MODEL);
  assert.strictEqual(result.config.agent_id, "mimo");
});

test("ultra speed is rejected via manual routing when not enabled", () => {
  const result = resolveRouting("mimo", {
    routing_mode: "manual",
    task_scenario: "complex",
    model: MIMO_ULTRA_SPEED_MODEL,
    reasoning_effort: "high",
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /Ultra Speed 未启用/);
});

test("auto routing never selects ultra speed even when enabled", () => {
  const config = { enable_mimo_pro_ultra_speed: true };
  for (const scenario of ["simple", "normal", "complex", "high_risk"]) {
    const profiles = getRoutingProfiles(config);
    assert.notStrictEqual(profiles.scenarios[scenario].current.model, MIMO_ULTRA_SPEED_MODEL);
  }
});

test("routing profile normalization rejects ultra speed scenario override when disabled", () => {
  const result = normalizeRoutingProfilesConfig({
    scenarios: {
      complex: {
        agent_id: "mimo",
        model: MIMO_ULTRA_SPEED_MODEL,
        reasoning_effort: "high",
      },
    },
  });
  assert.strictEqual(result.ok, false);
});

test("routing profile normalization drops stale ultra speed scenario override when switch is turned off", () => {
  const result = normalizeRoutingProfilesConfig({
    enable_mimo_pro_ultra_speed: false,
    scenarios: {
      complex: {
        agent_id: "mimo",
        model: MIMO_ULTRA_SPEED_MODEL,
        reasoning_effort: "high",
      },
      normal: {
        agent_id: "mimo",
        model: "mimo-v2.5-flash",
        reasoning_effort: "medium",
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.scenarios.complex, undefined);
  assert.strictEqual(result.config.scenarios.normal.model, "mimo-v2.5-flash");
  assert.strictEqual(result.config.enable_mimo_pro_ultra_speed, undefined);
});

test("routing profile normalization accepts ultra speed scenario override when enabled", () => {
  const result = normalizeRoutingProfilesConfig({
    enable_mimo_pro_ultra_speed: true,
    scenarios: {
      complex: {
        agent_id: "mimo",
        model: MIMO_ULTRA_SPEED_MODEL,
        reasoning_effort: "high",
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.config.scenarios.complex.model, MIMO_ULTRA_SPEED_MODEL);
});
