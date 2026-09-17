import type { Database } from "../db/client";
import { events } from "../db/schema";
import { newId } from "../ids";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

export interface DomainEvent {
  eventType: string;
  entityType: string;
  entityId: string;
  endeavourId?: string | null;
  subject?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

/** Appends to the event log inside the caller's transaction. The activity tape and /events read from it. */
export async function recordEvent(db: Executor, e: DomainEvent) {
  await db.insert(events).values({
    id: newId("event"),
    sourceSystem: "prospector",
    eventType: e.eventType,
    entityType: e.entityType,
    entityId: e.entityId,
    payload: {
      ...(e.data ?? {}),
      ...(e.endeavourId ? { endeavourId: e.endeavourId } : {}),
      ...(e.subject ? { subject: e.subject } : {}),
      ...(e.detail ? { detail: e.detail } : {}),
    },
  });
}
