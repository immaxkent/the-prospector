/**
 * Intake: brief → planner draft → operator review → activation.
 * The planner only ever proposes. Confirmation and activation are the operator's,
 * and activation runs the gate in docs/endeavour-spec.md.
 */
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import type { Database } from "../db/client";
import { endeavourSpecVersions, endeavours, intakeSessions, mailboxes, offers, segments } from "../db/schema";
import {
  AUTONOMY_LEVELS,
  ENABLED_AUTONOMY_LEVELS,
  ENDEAVOUR_KINDS,
  FIELD_VALUE_SCHEMAS,
  alignHorizonToKind,
  evaluateActivation,
  type AutonomyLevel,
  type EndeavourSpec,
  type FieldKey,
  type FieldState,
} from "../domain/endeavour-spec";
import { newId } from "../ids";
import { mergeDraft, planIntake, type PlanDeps, type PlannerQuestion } from "../intake/planner";
import { endPlan } from "../intake/progress";
import { operatorText, type IntakeAnswer } from "../intake/prompt";
import { conflict, invalid, notFound } from "./errors";
import { recordEvent, type Executor } from "./events";

export interface IntakeView {
  id: string;
  brief: string;
  status: "interviewing" | "ready" | "activated" | "abandoned";
  spec: EndeavourSpec | null;
  questions: IntakeAnswer[];
  blockers: ReturnType<typeof evaluateActivation>["blockers"];
  ready: boolean;
}

async function load(tx: Executor, id: string) {
  const [row] = await tx.select().from(intakeSessions).where(eq(intakeSessions.id, id)).for("update");
  if (!row) throw notFound("intake session");
  if (row.status === "activated") throw conflict("this intake has already been activated");
  return row;
}

async function connectedMailboxes(tx: Executor) {
  const rows = await tx
    .select({ id: mailboxes.id, aliases: mailboxes.aliases })
    .from(mailboxes)
    .where(eq(mailboxes.status, "connected"));
  return rows.map((r) => ({ id: r.id, aliases: r.aliases.map((a) => a.address) }));
}

function view(
  row: { id: string; brief: string; status: IntakeView["status"]; draftSpec: EndeavourSpec | null; questions: IntakeAnswer[] },
  connected: Awaited<ReturnType<typeof connectedMailboxes>>,
): IntakeView {
  const gate = row.draftSpec
    ? evaluateActivation(row.draftSpec, { brief: operatorText(row.brief, row.questions), connectedMailboxes: connected })
    : { ready: false, blockers: [] };
  return {
    id: row.id,
    brief: row.brief,
    status: row.status,
    spec: row.draftSpec,
    questions: row.questions,
    blockers: gate.blockers,
    ready: gate.ready,
  };
}

/** Keeps answers the operator has already given and adds the planner's new questions. */
function mergeQuestions(existing: readonly IntakeAnswer[], asked: readonly PlannerQuestion[]): IntakeAnswer[] {
  const answered = existing.filter((q) => q.answer.trim());
  const open = asked
    .filter((q) => !answered.some((a) => a.field === q.field))
    .map((q) => ({ field: q.field, question: q.question, answer: "" }));
  return [...answered, ...open];
}

export async function startIntake(
  db: Database,
  deps: PlanDeps,
  input: { brief: string; today: string; planId?: string | undefined },
): Promise<IntakeView> {
  const brief = input.brief.trim();
  if (brief.length < 40) throw invalid("describe the endeavour in a few sentences first");

  const id = newId("intake");
  await db.insert(intakeSessions).values({ id, brief, questions: [] });
  let plan;
  try {
    plan = await planIntake(deps, { brief, answers: [], today: input.today, planId: input.planId });
  } finally {
    // Whether it worked or not, nothing is waiting on this any more.
    if (input.planId) endPlan(input.planId);
  }
  const draftSpec = mergeDraft(null, plan.spec);
  const questions = mergeQuestions([], plan.questions);

  return db.transaction(async (tx) => {
    await tx.update(intakeSessions).set({ draftSpec, questions }).where(eq(intakeSessions.id, id));
    await recordEvent(tx, { eventType: "intake.started", entityType: "intake", entityId: id, subject: draftSpec.name });
    return view({ id, brief, status: "interviewing", draftSpec, questions }, await connectedMailboxes(tx));
  });
}

export async function answerIntake(
  db: Database,
  deps: PlanDeps,
  input: { intakeId: string; answers: { field: string; answer: string }[]; today: string },
): Promise<IntakeView> {
  const session = await db.transaction(async (tx) => load(tx, input.intakeId));
  const answers: IntakeAnswer[] = session.questions.map((q) => {
    const given = input.answers.find((a) => a.field === q.field);
    return given ? { ...q, answer: given.answer.trim() } : q;
  });
  if (!answers.some((a) => a.answer.trim())) throw invalid("answer at least one question first");

  const plan = await planIntake(deps, { brief: session.brief, answers, today: input.today });
  const draftSpec = mergeDraft(session.draftSpec, plan.spec);
  const questions = mergeQuestions(answers, plan.questions);

  return db.transaction(async (tx) => {
    await tx.update(intakeSessions).set({ draftSpec, questions }).where(eq(intakeSessions.id, input.intakeId));
    return view({ ...session, draftSpec, questions }, await connectedMailboxes(tx));
  });
}

export type FieldEdit =
  | { field: FieldKey; action: "confirm" }
  | { field: FieldKey; action: "set"; value: unknown }
  | { field: FieldKey; action: "not_applicable"; reason: string };

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(ENDEAVOUR_KINDS).optional(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(),
  /** null puts the endeavour back on the account's own address. */
  fromAlias: z.string().trim().min(1).nullable().optional(),
});

/** The operator confirms a proposal, replaces a value, or marks a field not applicable. */
export async function editIntakeField(db: Database, input: { intakeId: string } & FieldEdit): Promise<IntakeView> {
  return db.transaction(async (tx) => {
    const session = await load(tx, input.intakeId);
    if (!session.draftSpec) throw conflict("this intake has no draft yet");
    const current = session.draftSpec[input.field] as FieldState<unknown>;

    let next: FieldState<unknown>;
    if (input.action === "confirm") {
      if (current.state === "missing" || current.state === "not_applicable")
        throw invalid("there is nothing to confirm for this field");
      next = { state: "confirmed", value: (current as { value: unknown }).value };
    } else if (input.action === "set") {
      const parsed = FIELD_VALUE_SCHEMAS[input.field].safeParse(input.value);
      if (!parsed.success) throw invalid(z.prettifyError(parsed.error));
      next = { state: "confirmed", value: parsed.data };
    } else {
      const reason = input.reason.trim();
      if (!reason) throw invalid("say why this field does not apply");
      next = { state: "not_applicable", reason };
    }

    const draftSpec = { ...session.draftSpec, [input.field]: next } as EndeavourSpec;
    await tx.update(intakeSessions).set({ draftSpec }).where(eq(intakeSessions.id, session.id));
    return view({ ...session, draftSpec }, await connectedMailboxes(tx));
  });
}

/** The conversion needs a day to count from; the caller's clock is fine for a date. */
const localToday = (now: Date) => now.toISOString().slice(0, 10);

export async function updateIntakeSettings(
  db: Database,
  input: {
    intakeId: string;
    name?: string | undefined;
    kind?: "sprint" | "ongoing" | undefined;
    autonomyLevel?: AutonomyLevel | undefined;
    fromAlias?: string | null | undefined;
  },
  now = new Date(),
): Promise<IntakeView> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw invalid(z.prettifyError(parsed.error));
  if (parsed.data.autonomyLevel && !ENABLED_AUTONOMY_LEVELS.includes(parsed.data.autonomyLevel))
    throw invalid(`${parsed.data.autonomyLevel} is not available in v1`);

  return db.transaction(async (tx) => {
    const session = await load(tx, input.intakeId);
    if (!session.draftSpec) throw conflict("this intake has no draft yet");
    // A key the caller left out arrives as undefined, which would otherwise erase the
    // value it was not asking about. Only what was actually sent is applied.
    const given = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    let draftSpec = { ...session.draftSpec, ...given } as EndeavourSpec;
    // Changing the kind changes what a horizon has to look like. Leaving the old shape in
    // place told the operator their horizon was wrong the instant they changed the kind.
    if (parsed.data.kind && parsed.data.kind !== session.draftSpec.kind) {
      draftSpec = { ...draftSpec, horizon: alignHorizonToKind(draftSpec.horizon, parsed.data.kind, localToday(now)) };
    }
    await tx.update(intakeSessions).set({ draftSpec }).where(eq(intakeSessions.id, session.id));
    return view({ ...session, draftSpec }, await connectedMailboxes(tx));
  });
}

export async function abandonIntake(db: Database, input: { intakeId: string }) {
  return db.transaction(async (tx) => {
    const session = await load(tx, input.intakeId);
    await tx.update(intakeSessions).set({ status: "abandoned" }).where(eq(intakeSessions.id, session.id));
  });
}

const confirmed = <T>(f: FieldState<T>) => (f.state === "stated" || f.state === "confirmed" ? f.value : undefined);

/** Creates the endeavour once, and only when every check passes. */
export async function activateIntake(db: Database, input: { intakeId: string }, now = new Date()) {
  return db.transaction(async (tx) => {
    const session = await load(tx, input.intakeId);
    if (!session.draftSpec) throw conflict("this intake has no draft yet");
    const spec = session.draftSpec;
    const gate = evaluateActivation(spec, {
      brief: operatorText(session.brief, session.questions),
      connectedMailboxes: await connectedMailboxes(tx),
    });
    if (!gate.ready) throw conflict(gate.blockers.map((b) => b.message).join("; "));

    const endeavourId = newId("endeavour");
    const mailboxId = confirmed(spec.mailboxId)!;
    await tx.insert(endeavours).values({
      id: endeavourId,
      name: spec.name,
      kind: spec.kind,
      status: "active",
      autonomyLevel: spec.autonomyLevel,
      mailboxId,
      fromAlias: spec.fromAlias,
      spec,
      specVersion: 1,
      brief: session.brief,
      activatedAt: now,
    });
    await tx.insert(endeavourSpecVersions).values({
      id: newId("specVersion"),
      endeavourId,
      version: 1,
      spec,
      brief: session.brief,
      reason: "Activated from intake",
    });
    for (const buyer of confirmed(spec.buyers) ?? []) {
      await tx.insert(segments).values({
        id: newId("segment"),
        endeavourId,
        name: buyer.name,
        definition: buyer.definition,
        signals: buyer.signals,
        painHypothesis: buyer.painHypothesis,
        priority: buyer.priority,
        specVersion: 1,
      });
    }
    const offering = confirmed(spec.offering);
    if (offering) {
      await tx.insert(offers).values({
        id: newId("offer"),
        endeavourId,
        name: offering.summary.slice(0, 120),
        proposition: [offering.summary, ...offering.deliverables].join(" · "),
        pricing: confirmed(spec.pricing) ?? null,
        specVersion: 1,
      });
    }
    await tx
      .update(intakeSessions)
      .set({ status: "activated", endeavourId })
      .where(eq(intakeSessions.id, session.id));
    await recordEvent(tx, {
      eventType: "endeavour.activated",
      entityType: "endeavour",
      entityId: endeavourId,
      endeavourId,
      subject: spec.name,
      detail: `${spec.kind} · ${spec.autonomyLevel}`,
    });
    return { endeavourId };
  });
}
