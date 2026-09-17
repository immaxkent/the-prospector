/** Row types and time helpers shared by the read-model builders. */
import type { InferSelectModel } from "drizzle-orm";
import type * as t from "../db/schema";

export type EndeavourRow = InferSelectModel<typeof t.endeavours>;
export type MailboxRow = InferSelectModel<typeof t.mailboxes>;
export type SegmentRow = InferSelectModel<typeof t.segments>;
export type CompanyRow = InferSelectModel<typeof t.companies>;
export type PersonRow = InferSelectModel<typeof t.people>;
export type ProspectRow = InferSelectModel<typeof t.prospects>;
export type EvidenceRow = InferSelectModel<typeof t.evidence>;
export type TriggerRow = InferSelectModel<typeof t.triggers>;
export type ThreadRow = InferSelectModel<typeof t.threads>;
export type MessageRow = InferSelectModel<typeof t.messages>;
export type ApprovalRow = InferSelectModel<typeof t.approvals>;
export type OpportunityRow = InferSelectModel<typeof t.opportunities>;
export type InsightRow = InferSelectModel<typeof t.insights>;
export type RunRow = InferSelectModel<typeof t.dailyRuns>;
export type RunLogRow = InferSelectModel<typeof t.runLog>;
export type EventRow = InferSelectModel<typeof t.events>;

export const OPERATOR_TIMEZONE = "Europe/London";

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, timeZone = OPERATOR_TIMEZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function sameLocalDay(a: Date | null | undefined, b: Date, timeZone = OPERATOR_TIMEZONE) {
  return !!a && localDate(a, timeZone) === localDate(b, timeZone);
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
