/**
 * Prospect pipeline stages and who may move a prospect between them.
 * The system only moves forward; the user may correct anything.
 */
export const PIPELINE_STAGES = [
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "replied",
  "meeting",
  "proposal",
  "won",
  "lost",
  "nurture",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages on the main line, in order. `lost` and `nurture` sit off it. */
export const PROGRESSION: readonly PipelineStage[] = PIPELINE_STAGES.slice(0, 8);

export const TERMINAL_STAGES: readonly PipelineStage[] = ["won", "lost"];

export type Actor = "system" | "user";

export function canTransition(from: PipelineStage, to: PipelineStage, actor: Actor) {
  if (from === to) return false;
  if (actor === "user") return true;
  if (TERMINAL_STAGES.includes(from)) return false;
  if (to === "lost" || to === "nurture") return true;
  if (from === "nurture") return to === "contacted" || to === "replied";
  const a = PROGRESSION.indexOf(from);
  const b = PROGRESSION.indexOf(to);
  return b > a;
}

export class StageTransitionError extends Error {
  constructor(
    readonly from: PipelineStage,
    readonly to: PipelineStage,
    readonly actor: Actor,
  ) {
    super(`${actor} cannot move a prospect from ${from} to ${to}`);
  }
}

export function assertTransition(from: PipelineStage, to: PipelineStage, actor: Actor) {
  if (!canTransition(from, to, actor)) throw new StageTransitionError(from, to, actor);
}
