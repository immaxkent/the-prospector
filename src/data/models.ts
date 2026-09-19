/** Models the operator may choose. Mirrors the server's list so the browser needs no server import. */
export const SELECTABLE_MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "cheapest" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "better judgement, ~3x the cost" },
  { id: "claude-opus-5", label: "Opus 5", note: "strongest, far more expensive" },
] as const;
