import { describe, expect, it } from "vitest";
import { buildProspectDetail, prospectTimeline } from "./prospect-detail";
import type { ProspectLookups } from "./prospects";
import {
  T0,
  companyRow,
  eventRow,
  evidenceRow,
  interactionRow,
  messageRow,
  personRow,
  prospectRow,
  segmentRow,
  triggerRow,
} from "./testing";

const lookups = (o: Partial<ProspectLookups> = {}): ProspectLookups => ({
  companies: new Map([["com_1", companyRow()]]),
  people: new Map([["per_1", personRow()]]),
  segments: new Map([["seg_1", segmentRow()]]),
  evidence: [],
  triggers: [],
  messages: [],
  opportunities: [],
  ...o,
});

const at = (iso: string) => new Date(iso);

describe("prospectTimeline", () => {
  const entries = (o: Parameters<typeof prospectTimeline>[0]) => prospectTimeline(o);
  const base = {
    prospect: prospectRow({ qualificationScore: null }),
    lookups: { evidence: [], triggers: [], messages: [] },
    interactions: [],
    events: [],
    entityIds: new Set(["pro_1", "com_1", "per_1"]),
  };

  it("is newest first, across every table it was assembled from", () => {
    const tape = entries({
      ...base,
      lookups: {
        evidence: [evidenceRow({ id: "ev_1", capturedAt: at("2026-09-01T00:00:00Z") })],
        triggers: [],
        messages: [messageRow({ id: "msg_1", sentAt: at("2026-09-05T00:00:00Z") })],
      },
      interactions: [interactionRow({ id: "int_1", occurredAt: at("2026-09-09T00:00:00Z") })],
    });
    expect(tape.map((e) => e.id)).toEqual(["int_1", "msg_1", "ev_1"]);
  });

  it("keeps research and the trigger apart, and says when the trigger happened", () => {
    const tape = entries({
      ...base,
      lookups: { evidence: [], triggers: [triggerRow({ occurredOn: "2026-09-10" })], messages: [] },
    });
    expect(tape[0]).toMatchObject({
      kind: "trigger",
      title: "Seed round announced",
      detail: "Happened 2026-09-10",
    });
  });

  it("says plainly when a trigger has no date, rather than leaving the field empty", () => {
    const tape = entries({
      ...base,
      lookups: { evidence: [], triggers: [triggerRow({ occurredOn: null })], messages: [] },
    });
    expect(tape[0]?.detail).toBe("No date recorded");
  });

  it("only shows the score once there is one", () => {
    expect(entries(base).some((e) => e.kind === "qualified")).toBe(false);
    const scored = entries({
      ...base,
      prospect: prospectRow({ qualificationScore: 82, scoreReason: "Named CTO" }),
    });
    expect(scored.find((e) => e.kind === "qualified")).toMatchObject({
      title: "Scored 82",
      detail: "Named CTO",
    });
  });

  it("records the release as its own moment, because nothing is drafted before it", () => {
    const tape = entries({
      ...base,
      prospect: prospectRow({ qualificationScore: null, releasedAt: at("2026-09-20T00:00:00Z") }),
    });
    expect(tape[0]).toMatchObject({ kind: "released" });
  });

  it("separates what was sent from what came back", () => {
    const tape = entries({
      ...base,
      lookups: {
        evidence: [],
        triggers: [],
        messages: [
          messageRow({ id: "out", direction: "outbound", sentAt: at("2026-09-01T00:00:00Z") }),
          messageRow({
            id: "in",
            direction: "inbound",
            sentAt: null,
            receivedAt: at("2026-09-02T00:00:00Z"),
          }),
        ],
      },
    });
    expect(tape.map((e) => e.kind)).toEqual(["received", "sent"]);
  });

  it("leaves out a message that has not happened yet", () => {
    // A queued draft has neither a sent nor a received time; putting it on the tape would
    // claim something happened.
    const tape = entries({
      ...base,
      lookups: {
        evidence: [],
        triggers: [],
        messages: [messageRow({ sentAt: null, receivedAt: null })],
      },
    });
    expect(tape).toEqual([]);
  });

  it("says which way round a conversation elsewhere went", () => {
    const tape = entries({
      ...base,
      interactions: [
        interactionRow({
          direction: "inbound",
          channel: "discord",
          note: "Answered in their server",
        }),
      ],
    });
    expect(tape[0]).toMatchObject({
      kind: "elsewhere",
      title: "They answered on discord",
      detail: "Answered in their server",
    });
  });

  it("names the decisions from the event log, with the reason when one was given", () => {
    const tape = entries({
      ...base,
      events: [
        eventRow({ eventType: "prospect.rejected", payload: { reason: "Already audited" } }),
      ],
    });
    expect(tape[0]).toMatchObject({
      kind: "decision",
      title: "Rejected",
      detail: "Already audited",
    });
  });

  it("ignores events that are not about this prospect's history", () => {
    const tape = entries({ ...base, events: [eventRow({ eventType: "mailbox.connected" })] });
    expect(tape).toEqual([]);
  });

  it("takes evidence about the company and the person, not only the prospect row", () => {
    const tape = entries({
      ...base,
      lookups: {
        evidence: [
          evidenceRow({ id: "ev_company", entityType: "company", entityId: "com_1" }),
          evidenceRow({ id: "ev_other", entityId: "pro_999" }),
        ],
        triggers: [],
        messages: [],
      },
    });
    expect(tape.map((e) => e.id)).toEqual(["ev_company"]);
  });

  it("does not wobble between reads when two things share a timestamp", () => {
    const twice = () =>
      entries({
        ...base,
        lookups: {
          evidence: [
            evidenceRow({ id: "ev_b", capturedAt: T0 }),
            evidenceRow({ id: "ev_a", capturedAt: T0 }),
          ],
          triggers: [],
          messages: [],
        },
      }).map((e) => e.id);
    expect(twice()).toEqual(["ev_a", "ev_b"]);
    expect(twice()).toEqual(twice());
  });
});

describe("buildProspectDetail", () => {
  it("keeps everything the list already showed and adds what the screen needs", () => {
    const detail = buildProspectDetail(
      prospectRow({ qualificationScore: 92 }),
      lookups({
        companies: new Map([
          [
            "com_1",
            companyRow({
              timezone: "Europe/Amsterdam",
              contacts: [{ channel: "discord", value: "discord.gg/nb" }],
            }),
          ],
        ]),
      }),
      { interactions: [], events: [] },
    );

    expect(detail).toMatchObject({
      score: 92,
      person: "Ilse Vermeer",
      companyName: "Northbridge",
      companyDomain: "northbridge.example",
      companyTimezone: "Europe/Amsterdam",
      personEmail: "ilse@northbridge.example",
    });
    expect(detail.routes.map((r) => r.channel)).toEqual(["email", "discord"]);
  });

  it("holds together when the prospect has neither a company nor a person", () => {
    const detail = buildProspectDetail(
      prospectRow({ companyId: null, personId: null }),
      lookups(),
      { interactions: [], events: [] },
    );
    expect(detail).toMatchObject({
      companyName: "Unknown company",
      personEmail: null,
      companyDomain: null,
    });
    expect(detail.routes).toEqual([]);
  });
});
