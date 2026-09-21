/**
 * Operational truth. Normalised tables; JSON only where the shape is owned by a domain schema.
 * Fixture rows are flagged on root tables (is_fixture) and everything else cascades from them,
 * so fixtures can be purged in one operation.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { EndeavourSpec } from "../domain/endeavour-spec";
import type { MailboxAlias, MailboxLimits } from "../domain/mailbox";
import type { EndeavourSettings } from "../domain/endeavour-settings";
import { PIPELINE_STAGES } from "../domain/pipeline";
import { OUTBOUND_STATES } from "../domain/outbound";
import { AUTONOMY_LEVELS, ENDEAVOUR_KINDS } from "../domain/endeavour-spec";
import { MAILBOX_STATUSES } from "../domain/mailbox";

const id = () => text("id").primaryKey();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
const fixture = () => boolean("is_fixture").notNull().default(false);

/* ---------- enums ---------- */

export const endeavourKind = pgEnum("endeavour_kind", ENDEAVOUR_KINDS);
export const endeavourStatus = pgEnum("endeavour_status", ["draft", "active", "paused", "archived"]);
export const autonomyLevel = pgEnum("autonomy_level", AUTONOMY_LEVELS);
export const mailboxStatus = pgEnum("mailbox_status", MAILBOX_STATUSES);
export const pipelineStage = pgEnum("pipeline_stage", PIPELINE_STAGES);
export const reviewStatus = pgEnum("review_status", ["discovered", "researching", "qualified", "needs_review", "rejected"]);
export const outboundState = pgEnum("outbound_state", OUTBOUND_STATES);
export const messageDirection = pgEnum("message_direction", ["outbound", "inbound"]);
export const messageClass = pgEnum("message_class", ["new_outreach", "follow_up", "reply"]);
export const approvalKind = pgEnum("approval_kind", [
  "outreach_draft",
  "reply_approval",
  "hot_lead",
  "pricing_decision",
  "thread_mapping",
  "failed_run",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "interrupted"]);
export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed", "interrupted"]);
export const suppressionKind = pgEnum("suppression_kind", ["email", "domain"]);
export const intakeStatus = pgEnum("intake_status", ["interviewing", "ready", "activated", "abandoned"]);

/* ---------- operators ---------- */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    googleSub: text("google_sub"),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), uniqueIndex("users_google_sub_uq").on(t.googleSub)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the cookie token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/* ---------- mailboxes and endeavours ---------- */

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: id(),
    address: text("address").notNull(),
    displayName: text("display_name").notNull(),
    provider: text("provider", { enum: ["google"] }).notNull(),
    status: mailboxStatus("status").notNull().default("connected"),
    limits: jsonb("limits").$type<MailboxLimits>().notNull(),
    /** AES-GCM ciphertext of the OAuth token set. Never plaintext. */
    tokenCiphertext: text("token_ciphertext"),
    /**
     * Addresses this account may also send as. They share the account's sending limits,
     * because Google counts them against the same account, so they are not mailboxes.
     */
    aliases: jsonb("aliases").$type<MailboxAlias[]>().notNull().default([]),
    isFixture: fixture(),
    ...timestamps,
  },
  (t) => [uniqueIndex("mailboxes_address_uq").on(t.address)],
);

export const endeavours = pgTable(
  "endeavours",
  {
    id: id(),
    name: text("name").notNull(),
    kind: endeavourKind("kind").notNull(),
    status: endeavourStatus("status").notNull().default("draft"),
    autonomyLevel: autonomyLevel("autonomy_level").notNull().default("DRAFT"),
    mailboxId: text("mailbox_id").references(() => mailboxes.id, { onDelete: "restrict" }),
    /** One of the mailbox's aliases to send as, or null for the account's own address. */
    fromAlias: text("from_alias"),
    /** How this endeavour paces itself: sending window, gaps, follow-up days. Defaults when null. */
    settings: jsonb("settings").$type<Partial<EndeavourSettings>>().notNull().default({}),
    spec: jsonb("spec").$type<EndeavourSpec>().notNull(),
    specVersion: integer("spec_version").notNull().default(1),
    brief: text("brief").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    isFixture: fixture(),
    ...timestamps,
  },
  (t) => [index("endeavours_status_idx").on(t.status), index("endeavours_mailbox_idx").on(t.mailboxId)],
);

export const endeavourSpecVersions = pgTable(
  "endeavour_spec_versions",
  {
    id: id(),
    endeavourId: text("endeavour_id")
      .notNull()
      .references(() => endeavours.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: jsonb("spec").$type<EndeavourSpec>().notNull(),
    brief: text("brief").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("spec_versions_uq").on(t.endeavourId, t.version)],
);

export const intakeSessions = pgTable("intake_sessions", {
  id: id(),
  brief: text("brief").notNull(),
  /** The draft the operator is reviewing: planner proposals plus their confirmations. */
  draftSpec: jsonb("draft_spec").$type<EndeavourSpec>(),
  questions: jsonb("questions").$type<{ field: string; question: string; answer: string }[]>().notNull().default([]),
  status: intakeStatus("status").notNull().default("interviewing"),
  endeavourId: text("endeavour_id").references(() => endeavours.id, { onDelete: "set null" }),
  ...timestamps,
});

export const segments = pgTable("segments", {
  id: id(),
  endeavourId: text("endeavour_id")
    .notNull()
    .references(() => endeavours.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  definition: text("definition").notNull(),
  signals: jsonb("signals").$type<string[]>().notNull(),
  painHypothesis: text("pain_hypothesis").notNull(),
  priority: integer("priority").notNull(),
  specVersion: integer("spec_version").notNull(),
  status: text("status", { enum: ["active", "retired"] }).notNull().default("active"),
  ...timestamps,
});

export const offers = pgTable("offers", {
  id: id(),
  endeavourId: text("endeavour_id")
    .notNull()
    .references(() => endeavours.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  proposition: text("proposition").notNull(),
  pricing: jsonb("pricing").$type<Record<string, unknown>>(),
  cta: text("cta"),
  specVersion: integer("spec_version").notNull(),
  status: text("status", { enum: ["active", "retired"] }).notNull().default("active"),
  ...timestamps,
});

/* ---------- prospects and research ---------- */

export const companies = pgTable(
  "companies",
  {
    id: id(),
    name: text("name").notNull(),
    domain: text("domain"),
    description: text("description"),
    /** IANA timezone of where the company works, when research established it. Aims a send at their morning. */
    timezone: text("timezone"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    isFixture: fixture(),
    ...timestamps,
  },
  (t) => [uniqueIndex("companies_domain_uq").on(t.domain).where(sql`${t.domain} is not null`)],
);

export const people = pgTable(
  "people",
  {
    id: id(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    isFixture: fixture(),
    ...timestamps,
  },
  (t) => [uniqueIndex("people_email_uq").on(t.email).where(sql`${t.email} is not null`)],
);

export interface ScoreFactor {
  factor: string;
  score: number;
  weight: number;
  note: string;
  evidenceIds: string[];
}

export const prospects = pgTable(
  "prospects",
  {
    id: id(),
    endeavourId: text("endeavour_id")
      .notNull()
      .references(() => endeavours.id, { onDelete: "cascade" }),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
    segmentId: text("segment_id").references(() => segments.id, { onDelete: "set null" }),
    stage: pipelineStage("stage").notNull().default("discovered"),
    reviewStatus: reviewStatus("review_status").notNull().default("discovered"),
    qualificationScore: integer("qualification_score"),
    scoreFactors: jsonb("score_factors").$type<ScoreFactor[]>().notNull().default([]),
    scoreReason: text("score_reason"),
    rejectionReason: text("rejection_reason"),
    source: text("source").notNull(),
    nextAction: text("next_action"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("prospects_endeavour_person_uq").on(t.endeavourId, t.personId),
    index("prospects_stage_idx").on(t.endeavourId, t.stage),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    entityType: text("entity_type", { enum: ["company", "person", "prospect", "endeavour"] }).notNull(),
    entityId: text("entity_id").notNull(),
    sourceType: text("source_type", { enum: ["web", "import", "manual", "email"] }).notNull(),
    sourceRef: text("source_ref").notNull(),
    excerpt: text("excerpt"),
    claim: text("claim").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    runId: text("run_id"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_entity_idx").on(t.entityType, t.entityId)],
);

export const triggers = pgTable("triggers", {
  id: id(),
  prospectId: text("prospect_id")
    .notNull()
    .references(() => prospects.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  evidenceId: text("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- conversations ---------- */

export const threads = pgTable(
  "threads",
  {
    id: id(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    endeavourId: text("endeavour_id").references(() => endeavours.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
    externalThreadId: text("external_thread_id"),
    subject: text("subject").notNull(),
    mappingState: text("mapping_state", { enum: ["mapped", "needs_review", "ignored"] })
      .notNull()
      .default("mapped"),
    unread: boolean("unread").notNull().default(false),
    intent: text("intent"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("threads_external_uq").on(t.mailboxId, t.externalThreadId).where(sql`${t.externalThreadId} is not null`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    endeavourId: text("endeavour_id").references(() => endeavours.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
    direction: messageDirection("direction").notNull(),
    messageClass: messageClass("message_class"),
    externalMessageId: text("external_message_id"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** Only set for inbound replies whose objections were extracted; body is never rewritten. */
    classification: jsonb("classification").$type<Record<string, unknown>>(),
    templateVersion: text("template_version"),
    /** The offer this email pitched, so performance can be read by offer. */
    offerId: text("offer_id").references(() => offers.id, { onDelete: "set null" }),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    sendState: outboundState("send_state"),
    sendAttempts: integer("send_attempts").notNull().default(0),
    lastError: text("last_error"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** The slot this message was given: it is not sent before this moment. */
    scheduledSendAt: timestamp("scheduled_send_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("messages_external_uq").on(t.externalMessageId).where(sql`${t.externalMessageId} is not null`),
    index("messages_send_state_idx").on(t.sendState),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    endeavourId: text("endeavour_id")
      .notNull()
      .references(() => endeavours.id, { onDelete: "cascade" }),
    prospectId: text("prospect_id").references(() => prospects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: text("status", { enum: ["due", "done", "skipped"] }).notNull().default("due"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("activities_due_idx").on(t.endeavourId, t.status, t.dueAt)],
);

export const opportunities = pgTable("opportunities", {
  id: id(),
  endeavourId: text("endeavour_id")
    .notNull()
    .references(() => endeavours.id, { onDelete: "cascade" }),
  prospectId: text("prospect_id").references(() => prospects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  value: integer("value").notNull(),
  currency: text("currency").notNull(),
  stage: pipelineStage("stage").notNull(),
  probabilityUserDefined: doublePrecision("probability_user_defined"),
  expectedClose: date("expected_close"),
  outcomeReason: text("outcome_reason"),
  ...timestamps,
});

/* ---------- control ---------- */

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    endeavourId: text("endeavour_id")
      .notNull()
      .references(() => endeavours.id, { onDelete: "cascade" }),
    kind: approvalKind("kind").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    subjectType: text("subject_type", { enum: ["message", "thread", "prospect", "run", "opportunity"] }).notNull(),
    subjectId: text("subject_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("approvals_pending_idx").on(t.status, t.createdAt),
    uniqueIndex("approvals_open_subject_uq")
      .on(t.kind, t.subjectType, t.subjectId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: id(),
    kind: suppressionKind("kind").notNull(),
    value: text("value").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("suppressions_uq").on(t.kind, t.value)],
);

export const experiments = pgTable("experiments", {
  id: id(),
  endeavourId: text("endeavour_id")
    .notNull()
    .references(() => endeavours.id, { onDelete: "cascade" }),
  dimension: text("dimension").notNull(),
  variantA: text("variant_a").notNull(),
  variantB: text("variant_b").notNull(),
  status: text("status", { enum: ["running", "concluded"] }).notNull().default("running"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  ...timestamps,
});

export const insights = pgTable("insights", {
  id: id(),
  endeavourId: text("endeavour_id")
    .notNull()
    .references(() => endeavours.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["observation", "recommendation", "objection", "signal"] }).notNull(),
  statement: text("statement").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  confidence: doublePrecision("confidence").notNull(),
  status: text("status", { enum: ["open", "accepted", "dismissed"] }).notNull().default("open"),
  ...timestamps,
});

export const dailyRuns = pgTable(
  "daily_runs",
  {
    id: id(),
    endeavourId: text("endeavour_id")
      .notNull()
      .references(() => endeavours.id, { onDelete: "cascade" }),
    runDate: date("run_date").notNull(),
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
    status: runStatus("status").notNull().default("running"),
    phase: text("phase").notNull().default("load"),
    /** Last completed step, so a restarted run resumes after it. */
    checkpoint: integer("checkpoint").notNull().default(0),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    brief: jsonb("brief").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("daily_runs_uq").on(t.endeavourId, t.runDate)],
);

export const runLog = pgTable(
  "run_log",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => dailyRuns.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull(),
    text: text("text").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("run_log_run_idx").on(t.runId, t.at)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey), index("jobs_due_idx").on(t.status, t.runAt)],
);

export const llmCalls = pgTable("llm_calls", {
  id: id(),
  runId: text("run_id").references(() => dailyRuns.id, { onDelete: "set null" }),
  role: text("role").notNull(),
  promptVersion: text("prompt_version").notNull(),
  model: text("model").notNull(),
  inputHash: text("input_hash").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: doublePrecision("cost_usd").notNull(),
  status: text("status", { enum: ["ok", "invalid_output", "error"] }).notNull(),
  createdAt: timestamps.createdAt,
});

/**
 * Operator settings that must outlive a restart and be changeable without a deploy.
 * One row, id "singleton": there is one operator and one set of choices.
 */
export const appSettings = pgTable("app_settings", {
  id: text("id").primaryKey(),
  /** Claude model the agent roles use. */
  model: text("model").notNull(),
  /** Ceiling for a calendar month of model spend, in pence. */
  monthlyBudgetPence: integer("monthly_budget_pence").notNull(),
  ...timestamps,
});

export const events = pgTable(
  "events",
  {
    id: id(),
    sourceSystem: text("source_system").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** Monotonic cursor for GET /events?since= */
    seq: integer("seq").generatedAlwaysAsIdentity(),
  },
  (t) => [uniqueIndex("events_seq_uq").on(t.seq), index("events_entity_idx").on(t.entityType, t.entityId)],
);

export const notifications = pgTable("notifications", {
  id: id(),
  endeavourId: text("endeavour_id").references(() => endeavours.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamps.createdAt,
});
