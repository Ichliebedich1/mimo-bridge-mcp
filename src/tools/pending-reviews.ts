import { z } from "zod";
import type { TaskStore } from "../services/task-store.js";
import { getPendingReviewsSnapshot } from "../services/pending-reviews.js";

export const PendingReviewsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  max_chars: z.number().int().min(1000).max(20000).default(8000),
  agent_id: z.string().min(1).optional(),
});

export type PendingReviewsInput = z.infer<typeof PendingReviewsSchema>;

export function createPendingReviewsHandler(taskStore: TaskStore) {
  return {
    schema: PendingReviewsSchema,
    handler: async (input: PendingReviewsInput) => getPendingReviewsSnapshot(taskStore, input),
  };
}
