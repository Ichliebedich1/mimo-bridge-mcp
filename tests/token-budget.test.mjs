import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const testDir = join(__dirname, "test-token-budget");

describe("token-budget", () => {
  let TokenBudgetManager;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    const module = await import("../dist/services/token-budget.js");
    TokenBudgetManager = module.TokenBudgetManager;
  });

  after(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should initialize with default budget", () => {
    const manager = new TokenBudgetManager();
    const budget = manager.getBudget();

    assert.strictEqual(budget.max_input_tokens, 100000);
    assert.strictEqual(budget.max_output_tokens, 50000);
    assert.strictEqual(budget.max_total_tokens, 150000);
    assert.strictEqual(budget.max_cost, 1.0);
    assert.strictEqual(budget.warning_threshold, 0.8);
  });

  it("should initialize with custom budget", () => {
    const manager = new TokenBudgetManager({
      max_input_tokens: 50000,
      max_output_tokens: 25000,
    });

    const budget = manager.getBudget();
    assert.strictEqual(budget.max_input_tokens, 50000);
    assert.strictEqual(budget.max_output_tokens, 25000);
    assert.strictEqual(budget.max_total_tokens, 150000);
  });

  it("should record token usage", () => {
    const manager = new TokenBudgetManager();
    const status = manager.recordUsage(1000, 500, "test");

    assert.strictEqual(status.used.input_tokens, 1000);
    assert.strictEqual(status.used.output_tokens, 500);
    assert.strictEqual(status.used.total_tokens, 1500);
    assert.ok(status.used.estimated_cost > 0);
  });

  it("should accumulate token usage", () => {
    const manager = new TokenBudgetManager();

    manager.recordUsage(1000, 500, "first");
    manager.recordUsage(2000, 1000, "second");

    const usage = manager.getUsage();
    assert.strictEqual(usage.input_tokens, 3000);
    assert.strictEqual(usage.output_tokens, 1500);
    assert.strictEqual(usage.total_tokens, 4500);
  });

  it("should calculate remaining correctly", () => {
    const manager = new TokenBudgetManager({
      max_input_tokens: 10000,
      max_output_tokens: 5000,
      max_total_tokens: 15000,
    });

    manager.recordUsage(3000, 2000, "test");

    const status = manager.getStatus();
    assert.strictEqual(status.remaining.input_tokens, 7000);
    assert.strictEqual(status.remaining.output_tokens, 3000);
    assert.strictEqual(status.remaining.total_tokens, 10000);
  });

  it("should calculate utilization correctly", () => {
    const manager = new TokenBudgetManager({
      max_input_tokens: 10000,
      max_output_tokens: 5000,
    });

    manager.recordUsage(5000, 2500, "test");

    const status = manager.getStatus();
    assert.strictEqual(status.utilization.input_percent, 50);
    assert.strictEqual(status.utilization.output_percent, 50);
  });

  it("should generate warnings at threshold", () => {
    const manager = new TokenBudgetManager({
      max_input_tokens: 10000,
      warning_threshold: 0.8,
    });

    manager.recordUsage(8000, 1000, "test");

    const status = manager.getStatus();
    assert.ok(status.warnings.length > 0);
    assert.ok(status.warnings[0].includes("输入 token"));
  });

  it("should detect exceeded budget", () => {
    const manager = new TokenBudgetManager({
      max_total_tokens: 1000,
    });

    manager.recordUsage(600, 500, "test");

    const status = manager.getStatus();
    assert.strictEqual(status.exceeded, true);
  });

  it("should not exceed budget when under limit", () => {
    const manager = new TokenBudgetManager({
      max_total_tokens: 10000,
    });

    manager.recordUsage(1000, 500, "test");

    const status = manager.getStatus();
    assert.strictEqual(status.exceeded, false);
  });

  it("should reset usage", () => {
    const manager = new TokenBudgetManager();

    manager.recordUsage(1000, 500, "test");
    manager.reset();

    const usage = manager.getUsage();
    assert.strictEqual(usage.input_tokens, 0);
    assert.strictEqual(usage.output_tokens, 0);
    assert.strictEqual(usage.total_tokens, 0);
    assert.strictEqual(usage.estimated_cost, 0);
  });

  it("should update budget", () => {
    const manager = new TokenBudgetManager();

    manager.updateBudget({ max_input_tokens: 200000 });

    const budget = manager.getBudget();
    assert.strictEqual(budget.max_input_tokens, 200000);
  });

  it("should record history", () => {
    const manager = new TokenBudgetManager();

    manager.recordUsage(1000, 500, "first");
    manager.recordUsage(2000, 1000, "second");

    const history = manager.getHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].context, "first");
    assert.strictEqual(history[1].context, "second");
  });

  it("should generate report", () => {
    const manager = new TokenBudgetManager();

    manager.recordUsage(5000, 2000, "test");

    const report = manager.generateReport();
    assert.ok(report.includes("Token Budget Report"));
    assert.ok(report.includes("5,000"));
    assert.ok(report.includes("2,000"));
  });
});

describe("token-status handler", () => {
  let createTokenStatusHandler;
  let TokenBudgetManager;

  before(async () => {
    const module = await import("../dist/services/token-budget.js");
    TokenBudgetManager = module.TokenBudgetManager;

    const handlerModule = await import("../dist/tools/token-status.js");
    createTokenStatusHandler = handlerModule.createTokenStatusHandler;
  });

  it("should return token status", async () => {
    const budget = new TokenBudgetManager();
    budget.recordUsage(1000, 500, "test");

    const handler = createTokenStatusHandler({ tokenBudget: budget });
    const result = await handler.handler({ reset: false });

    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.used.input_tokens, 1000);
    assert.strictEqual(result.used.output_tokens, 500);
    assert.ok(result.report);
  });

  it("should reset token budget", async () => {
    const budget = new TokenBudgetManager();
    budget.recordUsage(1000, 500, "test");

    const handler = createTokenStatusHandler({ tokenBudget: budget });
    const result = await handler.handler({ reset: true });

    assert.strictEqual(result.status, "reset");

    const status = budget.getStatus();
    assert.strictEqual(status.used.input_tokens, 0);
  });

  it("should detect exceeded budget", async () => {
    const budget = new TokenBudgetManager({ max_total_tokens: 1000 });
    budget.recordUsage(600, 500, "test");

    const handler = createTokenStatusHandler({ tokenBudget: budget });
    const result = await handler.handler({ reset: false });

    assert.strictEqual(result.status, "exceeded");
    assert.strictEqual(result.exceeded, true);
  });
});
