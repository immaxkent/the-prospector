/**
 * Performance cuts and objection clusters, computed from stored records only.
 * Rates are shown with their denominators so a number is never bigger than its sample.
 */
import type { ObjectionCluster } from "@/data/types";
import type { MessageRow, OpportunityRow, ProspectRow, SegmentRow, TriggerRow } from "./rows";

export interface PerformanceCut {
  dimension: "segment" | "trigger" | "source" | "message_version";
  label: string;
  sent: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  wins: number;
  revenue: number;
}

/** Below this, a difference is noise; recommendations must wait for more evidence. */
export const MIN_SAMPLE = 15;

const POSITIVE_INTENTS = new Set(["interested", "question", "referral"]);
const MEETING_STAGES = new Set(["meeting", "proposal", "won"]);

export interface PerformanceInput {
  prospects: readonly ProspectRow[];
  messages: readonly MessageRow[];
  opportunities: readonly OpportunityRow[];
  segments: readonly SegmentRow[];
  triggers: readonly TriggerRow[];
}

function intentOf(message: MessageRow) {
  const intent = message.classification?.["intent"];
  return typeof intent === "string" ? intent : null;
}

/** Groups prospects by a label and counts what happened to each group. */
function cut(
  dimension: PerformanceCut["dimension"],
  labelled: readonly { label: string; prospect: ProspectRow }[],
  input: PerformanceInput,
): PerformanceCut[] {
  const byLabel = new Map<string, ProspectRow[]>();
  for (const { label, prospect } of labelled) {
    byLabel.set(label, [...(byLabel.get(label) ?? []), prospect]);
  }

  return [...byLabel.entries()]
    .map(([label, prospects]) => {
      const ids = new Set(prospects.map((p) => p.id));
      const own = input.messages.filter((m) => m.prospectId && ids.has(m.prospectId));
      const inbound = own.filter((m) => m.direction === "inbound");
      const repliedProspects = new Set(inbound.map((m) => m.prospectId));
      const positiveProspects = new Set(inbound.filter((m) => POSITIVE_INTENTS.has(intentOf(m) ?? "")).map((m) => m.prospectId));
      const won = input.opportunities.filter((o) => o.prospectId && ids.has(o.prospectId) && o.stage === "won");
      return {
        dimension,
        label,
        sent: own.filter((m) => m.direction === "outbound" && m.sendState === "sent").length,
        replies: repliedProspects.size,
        positiveReplies: positiveProspects.size,
        meetings: prospects.filter((p) => MEETING_STAGES.has(p.stage)).length,
        wins: prospects.filter((p) => p.stage === "won").length,
        revenue: won.reduce((sum, o) => sum + o.value, 0),
      };
    })
    .sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label));
}

export function buildPerformance(input: PerformanceInput): PerformanceCut[] {
  const active = input.prospects.filter((p) => p.reviewStatus !== "rejected");
  const segmentName = new Map(input.segments.map((s) => [s.id, s.name]));
  const triggerType = new Map(input.triggers.map((t) => [t.prospectId, t.type]));

  const cuts = [
    ...cut(
      "segment",
      active.filter((p) => p.segmentId).map((p) => ({ label: segmentName.get(p.segmentId!) ?? "Unknown segment", prospect: p })),
      input,
    ),
    ...cut(
      "trigger",
      active.filter((p) => triggerType.has(p.id)).map((p) => ({ label: triggerType.get(p.id)!, prospect: p })),
      input,
    ),
    ...cut("source", active.map((p) => ({ label: p.source, prospect: p })), input),
  ];

  // Message versions are a property of the message, not the prospect.
  const byVersion = new Map<string, MessageRow[]>();
  for (const message of input.messages) {
    if (message.direction !== "outbound" || message.sendState !== "sent" || !message.templateVersion) continue;
    byVersion.set(message.templateVersion, [...(byVersion.get(message.templateVersion) ?? []), message]);
  }
  for (const [label, sent] of byVersion) {
    const ids = new Set(sent.map((m) => m.prospectId).filter((id): id is string => !!id));
    const inbound = input.messages.filter((m) => m.direction === "inbound" && m.prospectId && ids.has(m.prospectId));
    const prospects = active.filter((p) => ids.has(p.id));
    cuts.push({
      dimension: "message_version",
      label,
      sent: sent.length,
      replies: new Set(inbound.map((m) => m.prospectId)).size,
      positiveReplies: new Set(inbound.filter((m) => POSITIVE_INTENTS.has(intentOf(m) ?? "")).map((m) => m.prospectId)).size,
      meetings: prospects.filter((p) => MEETING_STAGES.has(p.stage)).length,
      wins: prospects.filter((p) => p.stage === "won").length,
      revenue: input.opportunities.filter((o) => o.prospectId && ids.has(o.prospectId) && o.stage === "won").reduce((s, o) => s + o.value, 0),
    });
  }
  return cuts;
}

const STOP_WORDS = new Set(["the", "a", "an", "we", "our", "us", "is", "are", "to", "of", "and", "already", "have", "has", "for", "it", "this", "that"]);

/** A rough key so wordings of the same objection group together. */
export function objectionKey(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .sort()
    .slice(0, 4)
    .join(" ");
}

/** Objections as the prospects wrote them, grouped and counted. */
export function buildObjectionClusters(messages: readonly MessageRow[]): ObjectionCluster[] {
  const groups = new Map<string, { label: string; count: number; example: string }>();
  for (const message of messages) {
    const raw = message.classification?.["objections"];
    if (!Array.isArray(raw)) continue;
    for (const objection of raw) {
      if (typeof objection !== "string" || !objection.trim()) continue;
      const key = objectionKey(objection) || objection.toLowerCase();
      const existing = groups.get(key);
      groups.set(key, { label: existing?.label ?? objection, count: (existing?.count ?? 0) + 1, example: existing?.example ?? objection });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
