/** Scripted LLM for tests: returns queued responses in order and captures every request. */
import type { LlmClient, LlmRequest, LlmResponse, WebSource } from "./types";

export type Scripted = unknown | Error | ((req: LlmRequest) => unknown);

export class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly queue: Scripted[];

  constructor(
    responses: Scripted[],
    private readonly options: { sources?: WebSource[]; model?: string; raw?: boolean } = {},
  ) {
    this.queue = [...responses];
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    if (this.queue.length === 0) throw new Error("FakeLlm has no scripted response left");
    let next = this.queue.shift();
    if (typeof next === "function") next = (next as (r: LlmRequest) => unknown)(req);
    if (next instanceof Error) throw next;
    return {
      text: this.options.raw && typeof next === "string" ? next : JSON.stringify(next),
      model: this.options.model ?? req.model,
      usage: { inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: req.webSearch ? 1 : 0 },
      sources: this.options.sources ?? [],
    };
  }
}
