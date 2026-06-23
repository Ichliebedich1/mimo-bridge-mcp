export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
}

export interface TokenUsageRecordOptions {
  totalTokens?: number;
  estimatedCost?: number;
}

export interface TokenBudgetConfig {
  max_input_tokens: number;
  max_output_tokens: number;
  max_total_tokens: number;
  max_cost: number;
  warning_threshold: number;
}

export interface TokenBudgetStatus {
  used: TokenUsage;
  budget: TokenBudgetConfig;
  remaining: TokenUsage;
  utilization: {
    input_percent: number;
    output_percent: number;
    total_percent: number;
    cost_percent: number;
  };
  warnings: string[];
  exceeded: boolean;
}

const DEFAULT_BUDGET: TokenBudgetConfig = {
  max_input_tokens: 100000,
  max_output_tokens: 50000,
  max_total_tokens: 150000,
  max_cost: 1.0,
  warning_threshold: 0.8,
};

export class TokenBudgetManager {
  private budget: TokenBudgetConfig;
  private usage: TokenUsage;
  private history: Array<{ timestamp: number; usage: TokenUsage; context: string }>;

  constructor(budget: Partial<TokenBudgetConfig> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
    this.usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 };
    this.history = [];
  }

  getBudget(): TokenBudgetConfig {
    return { ...this.budget };
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  getHistory(): Array<{ timestamp: number; usage: TokenUsage; context: string }> {
    return [...this.history];
  }

  recordUsage(
    inputTokens: number,
    outputTokens: number,
    context: string = "",
    options: TokenUsageRecordOptions = {}
  ): TokenBudgetStatus {
    const safeInputTokens = Math.max(0, Math.floor(inputTokens));
    const safeOutputTokens = Math.max(0, Math.floor(outputTokens));
    const totalTokens = Math.max(0, Math.floor(options.totalTokens ?? safeInputTokens + safeOutputTokens));
    const cost = typeof options.estimatedCost === "number"
      ? Math.max(0, options.estimatedCost)
      : this.estimateCost(safeInputTokens, safeOutputTokens);

    this.usage.input_tokens += safeInputTokens;
    this.usage.output_tokens += safeOutputTokens;
    this.usage.total_tokens += totalTokens;
    this.usage.estimated_cost += cost;

    this.history.push({
      timestamp: Date.now(),
      usage: { input_tokens: safeInputTokens, output_tokens: safeOutputTokens, total_tokens: totalTokens, estimated_cost: cost },
      context,
    });

    return this.getStatus();
  }

  getStatus(): TokenBudgetStatus {
    const remaining: TokenUsage = {
      input_tokens: Math.max(0, this.budget.max_input_tokens - this.usage.input_tokens),
      output_tokens: Math.max(0, this.budget.max_output_tokens - this.usage.output_tokens),
      total_tokens: Math.max(0, this.budget.max_total_tokens - this.usage.total_tokens),
      estimated_cost: Math.max(0, this.budget.max_cost - this.usage.estimated_cost),
    };

    const utilization = {
      input_percent: (this.usage.input_tokens / this.budget.max_input_tokens) * 100,
      output_percent: (this.usage.output_tokens / this.budget.max_output_tokens) * 100,
      total_percent: (this.usage.total_tokens / this.budget.max_total_tokens) * 100,
      cost_percent: (this.usage.estimated_cost / this.budget.max_cost) * 100,
    };

    const warnings: string[] = [];
    if (utilization.input_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`输入 token 使用率已达 ${utilization.input_percent.toFixed(1)}%`);
    }
    if (utilization.output_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`输出 token 使用率已达 ${utilization.output_percent.toFixed(1)}%`);
    }
    if (utilization.total_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`总 token 使用率已达 ${utilization.total_percent.toFixed(1)}%`);
    }
    if (utilization.cost_percent >= this.budget.warning_threshold * 100) {
      warnings.push(`成本使用率已达 ${utilization.cost_percent.toFixed(1)}%`);
    }

    const exceeded = this.usage.total_tokens >= this.budget.max_total_tokens ||
                     this.usage.estimated_cost >= this.budget.max_cost;

    return {
      used: { ...this.usage },
      budget: { ...this.budget },
      remaining,
      utilization,
      warnings,
      exceeded,
    };
  }

  reset(): void {
    this.usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 };
    this.history = [];
  }

  updateBudget(budget: Partial<TokenBudgetConfig>): void {
    this.budget = { ...this.budget, ...budget };
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.0015;
    const outputCostPer1k = 0.002;
    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }

  generateReport(): string {
    const status = this.getStatus();
    const lines = [
      "# Token Budget Report",
      "",
      "## 当前使用情况",
      `- 输入 tokens: ${status.used.input_tokens.toLocaleString()} / ${status.budget.max_input_tokens.toLocaleString()} (${status.utilization.input_percent.toFixed(1)}%)`,
      `- 输出 tokens: ${status.used.output_tokens.toLocaleString()} / ${status.budget.max_output_tokens.toLocaleString()} (${status.utilization.output_percent.toFixed(1)}%)`,
      `- 总 tokens: ${status.used.total_tokens.toLocaleString()} / ${status.budget.max_total_tokens.toLocaleString()} (${status.utilization.total_percent.toFixed(1)}%)`,
      `- 预估成本: $${status.used.estimated_cost.toFixed(4)} / $${status.budget.max_cost.toFixed(2)} (${status.utilization.cost_percent.toFixed(1)}%)`,
      "",
      "## 剩余配额",
      `- 输入 tokens: ${status.remaining.input_tokens.toLocaleString()}`,
      `- 输出 tokens: ${status.remaining.output_tokens.toLocaleString()}`,
      `- 总 tokens: ${status.remaining.total_tokens.toLocaleString()}`,
      `- 预估成本: $${status.remaining.estimated_cost.toFixed(4)}`,
      "",
    ];

    if (status.warnings.length > 0) {
      lines.push("## 警告");
      for (const warning of status.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push("");
    }

    if (status.exceeded) {
      lines.push("## 状态: 已超限");
    } else {
      lines.push("## 状态: 正常");
    }

    return lines.join("\n");
  }
}

export const globalTokenBudget = new TokenBudgetManager();
