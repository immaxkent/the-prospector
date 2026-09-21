/** Row factories for read-model unit tests. Test-only. */
import { fixtureSpec, FIXTURE_BRIEF } from "../db/fixtures";
import { DEFAULT_MAILBOX_LIMITS } from "../domain/mailbox";
import type {
  ApprovalRow,
  CompanyRow,
  EndeavourRow,
  EvidenceRow,
  MailboxRow,
  MessageRow,
  OfferRow,
  OpportunityRow,
  PersonRow,
  ProspectRow,
  RunRow,
  SegmentRow,
  ThreadRow,
} from "./rows";

export const T0 = new Date("2026-09-17T08:00:00Z");

export function endeavourRow(o: Partial<EndeavourRow> = {}): EndeavourRow {
  return {
    id: "end_1",
    name: "£3K Solidity Sprint",
    kind: "sprint",
    status: "active",
    autonomyLevel: "DRAFT",
    mailboxId: "mbx_1",
    fromAlias: null,
    settings: {},
    spec: fixtureSpec("mbx_1"),
    specVersion: 1,
    brief: FIXTURE_BRIEF,
    activatedAt: new Date("2026-09-17T00:00:00Z"),
    isFixture: false,
    createdAt: new Date("2026-09-17T00:00:00Z"),
    updatedAt: new Date("2026-09-17T00:00:00Z"),
    ...o,
  };
}

export function mailboxRow(o: Partial<MailboxRow> = {}): MailboxRow {
  return {
    id: "mbx_1",
    address: "max@consulting.example",
    displayName: "Max",
    provider: "google",
    status: "connected",
    limits: DEFAULT_MAILBOX_LIMITS,
    tokenCiphertext: null,
    aliases: [],
    isFixture: false,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function prospectRow(o: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "pro_1",
    endeavourId: "end_1",
    companyId: "com_1",
    personId: "per_1",
    segmentId: "seg_1",
    stage: "qualified",
    reviewStatus: "qualified",
    qualificationScore: 80,
    scoreFactors: [],
    scoreReason: null,
    rejectionReason: null,
    source: "web",
    nextAction: null,
    nextActionAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function companyRow(o: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "com_1",
    name: "Northbridge",
    domain: "northbridge.example",
    description: null,
    timezone: null,
    metadata: {},
    isFixture: false,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function personRow(o: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "per_1",
    companyId: "com_1",
    name: "Ilse Vermeer",
    role: "CTO",
    email: "ilse@northbridge.example",
    linkedinUrl: null,
    metadata: {},
    isFixture: false,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function segmentRow(o: Partial<SegmentRow> = {}): SegmentRow {
  return {
    id: "seg_1",
    endeavourId: "end_1",
    name: "Launch-stage protocols",
    definition: "Pre-audit teams",
    signals: [],
    painHypothesis: "Audits booked out",
    priority: 1,
    specVersion: 1,
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function offerRow(o: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "off_1",
    endeavourId: "end_1",
    name: "Two-week security review",
    proposition: "A fixed-scope review before mainnet",
    pricing: null,
    cta: null,
    specVersion: 1,
    status: "active",
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function evidenceRow(o: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: "ev_1",
    entityType: "prospect",
    entityId: "pro_1",
    sourceType: "web",
    sourceRef: "https://northbridge.example/blog",
    excerpt: null,
    claim: "Mainnet on 30 October",
    confidence: 0.9,
    runId: null,
    capturedAt: T0,
    ...o,
  };
}

export function threadRow(o: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: "thr_1",
    mailboxId: "mbx_1",
    endeavourId: "end_1",
    prospectId: "pro_1",
    externalThreadId: "g-1",
    subject: "Bridge review",
    mappingState: "mapped",
    unread: false,
    intent: null,
    lastActivityAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function messageRow(o: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "msg_1",
    threadId: "thr_1",
    endeavourId: "end_1",
    prospectId: "pro_1",
    direction: "outbound",
    messageClass: "new_outreach",
    externalMessageId: null,
    subject: "Bridge review",
    body: "Hello",
    classification: null,
    templateVersion: null,
    offerId: null,
    evidenceIds: [],
    sendState: "sent",
    sendAttempts: 1,
    lastError: null,
    approvedAt: null,
    scheduledSendAt: null,
    sentAt: T0,
    receivedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function approvalRow(o: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: "apr_1",
    endeavourId: "end_1",
    kind: "outreach_draft",
    status: "pending",
    subjectType: "message",
    subjectId: "msg_1",
    payload: {},
    decisionNote: null,
    decidedAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function opportunityRow(o: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: "opp_1",
    endeavourId: "end_1",
    prospectId: "pro_1",
    name: "Bridge review",
    value: 750,
    currency: "GBP",
    stage: "proposal",
    probabilityUserDefined: null,
    expectedClose: null,
    outcomeReason: null,
    createdAt: T0,
    updatedAt: T0,
    ...o,
  };
}

export function runRow(o: Partial<RunRow> = {}): RunRow {
  return {
    id: "run_1",
    endeavourId: "end_1",
    runDate: "2026-09-17",
    trigger: "schedule",
    status: "succeeded",
    phase: "done",
    checkpoint: 12,
    metrics: {},
    brief: null,
    startedAt: T0,
    finishedAt: new Date(T0.getTime() + 90_000),
    ...o,
  };
}
