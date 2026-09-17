/**
 * The Interfaces screen: what this system exposes and what has actually crossed the seam.
 * Counts come from the event log, so a connector that has never been used says so.
 */
import type { InterfaceEvent, SystemInterface } from "@/data/types";
import { CANONICAL_EVENT_TYPES } from "../api/v1";
import { iso, type EventRow } from "./rows";

/** External systems the handoff names, plus this system's own API. */
const DEFINITIONS = [
  {
    id: "prospector_api",
    name: "Prospector API v1",
    endpoint: "/api/v1",
    schema: "v1",
    sourceSystem: "prospector",
    eventTypes: [...CANONICAL_EVENT_TYPES],
  },
  {
    id: "aweedinary",
    name: "AWEEDINARY",
    endpoint: "POST /api/v1/events",
    schema: "v1",
    sourceSystem: "aweedinary",
    eventTypes: ["product.milestone.completed", "product.capability.changed"],
  },
  {
    id: "good_paper",
    name: "Good Paper Agent OS",
    endpoint: "POST /api/v1/events",
    schema: "v1",
    sourceSystem: "good-paper",
    eventTypes: ["commercial.opportunity.created", "commercial.commitment.made"],
  },
] as const;

const summarise = (event: EventRow): InterfaceEvent => ({
  id: event.id,
  at: iso(event.occurredAt),
  direction: event.sourceSystem === "prospector" ? "OUT" : "IN",
  type: event.eventType,
  payloadSummary: [event.payload["subject"], event.payload["detail"]].filter((v) => typeof v === "string").join(" — ") || event.entityId,
});

export function buildInterfaces(events: readonly EventRow[], apiEnabled: boolean): SystemInterface[] {
  const canonical = new Set<string>(CANONICAL_EVENT_TYPES);

  return DEFINITIONS.map((definition) => {
    const own =
      definition.id === "prospector_api"
        ? events.filter((e) => e.sourceSystem === "prospector" && canonical.has(e.eventType))
        : events.filter((e) => e.sourceSystem === definition.sourceSystem);
    const recent = [...own].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 10);
    const inbound = own.filter((e) => e.sourceSystem !== "prospector").length;
    const outbound = own.length - inbound;

    const status: SystemInterface["status"] =
      own.length > 0 ? "ACTIVE" : definition.id === "prospector_api" ? (apiEnabled ? "READY" : "NOT_CONNECTED") : "INTERFACE_READY";

    return {
      id: definition.id,
      name: definition.name,
      status,
      endpoint: definition.endpoint,
      schema: definition.schema,
      eventTypes: [...definition.eventTypes],
      inbound,
      outbound,
      lastEventAt: recent[0] ? iso(recent[0].occurredAt) : null,
      events: recent.map(summarise),
    };
  });
}
