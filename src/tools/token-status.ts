import { z } from "zod";
import { globalTokenBudget, type TokenBudgetManager } from "../services/token-budget.js";

export interface TokenStatusDependencies {
  tokenBudget?: TokenBudgetManager;
}

export const TokenStatusSchema = z.object({
  reset: z.boolean().default(false),
});

export type TokenStatusInput = z.infer<typeof TokenStatusSchema>;

export function createTokenStatusHandler(
  dependencies: TokenStatusDependencies = {}
) {
  const tokenBudget = dependencies.tokenBudget ?? globalTokenBudget;

  return {
    schema: TokenStatusSchema,
    handler: async (input: TokenStatusInput) => {
      if (input.reset) {
        tokenBudget.reset();
        return {
          status: "reset",
          message: "Token 预算已重置",
        };
      }

      const status = tokenBudget.getStatus();
      const report = tokenBudget.generateReport();

      return {
        status: status.exceeded ? "exceeded" : "ok",
        used: status.used,
        remaining: status.remaining,
        utilization: status.utilization,
        warnings: status.warnings,
        exceeded: status.exceeded,
        report,
      };
    },
  };
}
