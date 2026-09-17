import type { Database } from "../db/client";
import { llmCalls } from "../db/schema";
import type { CallRecorder } from "./structured";

/** Persists every model call for audit and cost reporting. */
export function dbRecorder(db: Database): CallRecorder {
  return async (r) => {
    await db.insert(llmCalls).values({
      id: r.id,
      runId: r.runId,
      role: r.role,
      promptVersion: r.promptVersion,
      model: r.model,
      inputHash: r.inputHash,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      status: r.status,
    });
  };
}
