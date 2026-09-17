/**
 * EndeavourSpec: the structured definition the intake planner fills and the user approves.
 * Contract: docs/endeavour-spec.md. The server enforces it; the model never decides readiness.
 */
import { z } from "zod/v4";

/* ---------- field states ---------- */

const nonEmpty = z.string().trim().min(1);

function stateVariants<T extends z.ZodType>(value: T) {
  return {
    stated: z.object({ state: z.literal("stated"), value, quote: nonEmpty }),
    confirmed: z.object({ state: z.literal("confirmed"), value }),
    notApplicable: z.object({ state: z.literal("not_applicable"), reason: nonEmpty }),
    suggested: z.object({ state: z.literal("suggested"), value, rationale: nonEmpty }),
    missing: z.object({ state: z.literal("missing") }),
  };
}

/** Any state. What is stored and shown to the user. */
export function field<T extends z.ZodType>(value: T) {
  const v = stateVariants(value);
  return z.discriminatedUnion("state", [v.stated, v.confirmed, v.notApplicable, v.suggested, v.missing]);
}

/** Only the states the planner may emit. `confirmed` and `not_applicable` are the user's alone. */
export function plannerField<T extends z.ZodType>(value: T) {
  const v = stateVariants(value);
  return z.discriminatedUnion("state", [v.stated, v.suggested, v.missing]);
}

export type FieldState<T> =
  | { state: "stated"; value: T; quote: string }
  | { state: "confirmed"; value: T }
  | { state: "not_applicable"; reason: string }
  | { state: "suggested"; value: T; rationale: string }
  | { state: "missing" };

/* ---------- field values ---------- */

export const ENDEAVOUR_KINDS = ["sprint", "ongoing"] as const;
export const OBJECTIVE_METRICS = ["revenue", "customers", "users", "partners", "meetings", "custom"] as const;
export const PERIODS = ["week", "month", "quarter"] as const;
export const PRICING_MODELS = ["day_rate", "package", "retainer", "subscription", "rev_share", "free"] as const;
export const PROOF_KINDS = ["repo", "client", "case_study", "product", "metric", "publication"] as const;
export const AUTONOMY_LEVELS = ["OBSERVE", "DRAFT", "GUARDED", "DELEGATED"] as const;
/** Levels 2 and 3 exist in the model but cannot be activated in v1. */
export const ENABLED_AUTONOMY_LEVELS: readonly AutonomyLevel[] = ["OBSERVE", "DRAFT"];

const currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. GBP");

export const objectiveValue = z.object({
  metric: z.enum(OBJECTIVE_METRICS),
  target: z.number().positive(),
  unit: nonEmpty,
  currency: currency.optional(),
});

export const horizonValue = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sprint"), endsOn: z.iso.date() }),
  z.object({ kind: z.literal("ongoing"), period: z.enum(PERIODS), reviewEvery: z.number().int().positive() }),
]);

export const offeringValue = z.object({
  summary: nonEmpty,
  deliverables: z.array(nonEmpty).min(1),
});

export const pricingValue = z.object({
  model: z.enum(PRICING_MODELS),
  amount: z.number().positive().optional(),
  currency: currency.optional(),
  minimumDeal: z.number().positive().optional(),
});

export const proofItem = z.object({
  kind: z.enum(PROOF_KINDS),
  title: nonEmpty,
  url: z.url().optional(),
  claim: nonEmpty,
});

export const buyerSegment = z.object({
  name: nonEmpty,
  definition: nonEmpty,
  signals: z.array(nonEmpty).min(1),
  painHypothesis: nonEmpty,
  priority: z.number().int().min(1).max(5),
});

export const exclusionRule = z.object({ rule: nonEmpty, reason: nonEmpty });

export const cadenceValue = z.object({
  dailyNewTarget: z.number().int().min(0),
  dailyFollowupTarget: z.number().int().min(0),
});

export const endeavourSpecSchema = z.object({
  name: nonEmpty,
  kind: z.enum(ENDEAVOUR_KINDS),
  objective: field(objectiveValue),
  horizon: field(horizonValue),
  offering: field(offeringValue),
  pricing: field(pricingValue),
  proof: field(z.array(proofItem).min(1)),
  buyers: field(z.array(buyerSegment).min(1)),
  exclusions: field(z.array(exclusionRule)),
  mailboxId: field(nonEmpty),
  cadence: field(cadenceValue),
  channels: z.array(z.literal("email")).length(1),
  autonomyLevel: z.enum(AUTONOMY_LEVELS),
});

export type EndeavourSpec = z.infer<typeof endeavourSpecSchema>;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** The spec shape the planner returns. The mailbox is picked by the user, never the planner. */
export const plannerSpecSchema = z.object({
  name: nonEmpty,
  kind: z.enum(ENDEAVOUR_KINDS),
  objective: plannerField(objectiveValue),
  horizon: plannerField(horizonValue),
  offering: plannerField(offeringValue),
  pricing: plannerField(pricingValue),
  proof: plannerField(z.array(proofItem).min(1)),
  buyers: plannerField(z.array(buyerSegment).min(1)),
  exclusions: plannerField(z.array(exclusionRule)),
  cadence: plannerField(cadenceValue),
});

export type PlannerSpec = z.infer<typeof plannerSpecSchema>;

export const FIELD_KEYS = [
  "objective",
  "horizon",
  "offering",
  "pricing",
  "proof",
  "buyers",
  "exclusions",
  "mailboxId",
  "cadence",
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Value schema per field, used to validate what the operator confirms or edits. */
export const FIELD_VALUE_SCHEMAS = {
  objective: objectiveValue,
  horizon: horizonValue,
  offering: offeringValue,
  pricing: pricingValue,
  proof: z.array(proofItem).min(1),
  buyers: z.array(buyerSegment).min(1),
  exclusions: z.array(exclusionRule),
  mailboxId: nonEmpty,
  cadence: cadenceValue,
} as const satisfies Record<FieldKey, z.ZodType>;

/** Fields the user may mark not applicable. Pricing is further restricted for revenue objectives. */
const NOT_APPLICABLE_ALLOWED: readonly FieldKey[] = ["pricing", "proof"];

/* ---------- quote verification ---------- */

function normaliseText(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteAppearsInBrief(quote: string, brief: string) {
  const q = normaliseText(quote);
  return q.length > 0 && normaliseText(brief).includes(q);
}

/**
 * A `stated` field whose quote is not in the brief is downgraded to `suggested`.
 * Run on every planner output before it is stored.
 */
export function downgradeUnverifiedQuotes<S extends Pick<EndeavourSpec, Exclude<FieldKey, "mailboxId">>>(
  spec: S,
  brief: string,
): S {
  const next = { ...spec };
  for (const key of FIELD_KEYS) {
    if (key === "mailboxId") continue;
    const f = next[key] as FieldState<unknown>;
    if (f.state === "stated" && !quoteAppearsInBrief(f.quote, brief)) {
      (next as Record<string, unknown>)[key] = {
        state: "suggested",
        value: f.value,
        rationale: `Quoted text was not found in the brief: "${f.quote}"`,
      };
    }
  }
  return next;
}

/* ---------- activation gate ---------- */

export type BlockerCode =
  | "field_missing"
  | "field_suggested"
  | "not_applicable_not_allowed"
  | "quote_not_in_brief"
  | "horizon_kind_mismatch"
  | "pricing_required_for_revenue"
  | "pricing_amount_required"
  | "revenue_currency_required"
  | "exclusions_need_explicit_confirmation"
  | "mailbox_not_connected"
  | "autonomy_level_disabled";

export interface Blocker {
  field: FieldKey | "autonomyLevel";
  code: BlockerCode;
  message: string;
}

export interface ActivationContext {
  brief: string;
  connectedMailboxIds: readonly string[];
}

function resolved<T>(f: FieldState<T>): T | undefined {
  return f.state === "stated" || f.state === "confirmed" ? f.value : undefined;
}

export function evaluateActivation(spec: EndeavourSpec, ctx: ActivationContext) {
  const blockers: Blocker[] = [];
  const block = (field: Blocker["field"], code: BlockerCode, message: string) =>
    blockers.push({ field, code, message });

  for (const key of FIELD_KEYS) {
    const f = spec[key] as FieldState<unknown>;
    if (f.state === "missing") block(key, "field_missing", `${key} has not been provided`);
    if (f.state === "suggested") block(key, "field_suggested", `${key} is a suggestion and needs your confirmation`);
    if (f.state === "not_applicable" && !NOT_APPLICABLE_ALLOWED.includes(key))
      block(key, "not_applicable_not_allowed", `${key} cannot be marked not applicable`);
    if (f.state === "stated" && !quoteAppearsInBrief(f.quote, ctx.brief))
      block(key, "quote_not_in_brief", `${key} cites text that is not in the brief`);
  }

  const horizon = resolved(spec.horizon);
  if (horizon && horizon.kind !== spec.kind)
    block("horizon", "horizon_kind_mismatch", `a ${spec.kind} endeavour needs a ${spec.kind} horizon`);

  const objective = resolved(spec.objective);
  if (objective?.metric === "revenue") {
    if (!objective.currency) block("objective", "revenue_currency_required", "a revenue objective needs a currency");
    if (spec.pricing.state === "not_applicable")
      block("pricing", "pricing_required_for_revenue", "a revenue objective needs pricing");
    const pricing = resolved(spec.pricing);
    if (pricing && pricing.model !== "free" && pricing.amount === undefined)
      block("pricing", "pricing_amount_required", "pricing needs an amount for a revenue objective");
  }

  if (spec.exclusions.state === "stated" && spec.exclusions.value.length === 0)
    block("exclusions", "exclusions_need_explicit_confirmation", 'confirm "no exclusions" explicitly');

  const mailboxId = resolved(spec.mailboxId);
  if (mailboxId && !ctx.connectedMailboxIds.includes(mailboxId))
    block("mailboxId", "mailbox_not_connected", "the selected mailbox is not connected");

  if (!ENABLED_AUTONOMY_LEVELS.includes(spec.autonomyLevel))
    block("autonomyLevel", "autonomy_level_disabled", `${spec.autonomyLevel} is not available in v1`);

  return { ready: blockers.length === 0, blockers };
}

/** Drafts may only make claims about the sender when proof exists. */
export function senderClaimsAllowed(spec: EndeavourSpec) {
  const proof = resolved(spec.proof);
  return proof !== undefined && proof.length > 0;
}
