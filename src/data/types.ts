/**
 * CBO OS domain model.
 * Every value rendered in the UI originates from one of these records.
 */

export type AgentState = "ONLINE" | "RUNNING" | "WAITING" | "ERROR";
/** OBSERVE and DRAFT are enabled in v1; GUARDED and DELEGATED are shown but cannot be activated. */
export type AutonomyLevel = "OBSERVE" | "DRAFT" | "GUARDED" | "DELEGATED";
export type Health = "ON_TRACK" | "AT_RISK" | "BEHIND" | "PAUSED";

export type PipelineStage =
  | "discovered"
  | "researched"
  | "qualified"
  | "contacted"
  | "replied"
  | "meeting"
  | "proposal"
  | "won"
  | "lost"
  | "nurture";

export type EndeavourKind = "sprint" | "ongoing";

export interface Endeavour {
  id: string;
  name: string;
  kind: EndeavourKind;
  status: "draft" | "active" | "paused" | "archived";
  /** Mailbox this endeavour sends through. Null until one is chosen. */
  mailboxId: string | null;
  /** Alias of that mailbox this endeavour sends under, or null for the account's own address. */
  fromAlias: string | null;
  objective: string;
  unit: "GBP" | "COUNT";
  targetValue: number;
  actualValue: number;
  pipelineValue: number;
  /** Sprint: the end date. Ongoing: the end of the current period. */
  deadline: string; // ISO date
  horizonDays: number;
  /** Ongoing endeavours only. */
  period: "week" | "month" | "quarter" | null;
  health: Health;
  autonomy: AutonomyLevel;
  audienceNotes: string;
  offerNotes: string;
  channels: "EMAIL"[];
  dailyOutreachTarget: number;
  dailyFollowupTarget: number;
  quota: { newProspects: number; outreach: number; followups: number };
  quotaDone: { newProspects: number; outreach: number; followups: number };
  funnel: Record<PipelineStage, number>;
  qualifiedToday: number;
  repliesToday: number;
  nextCriticalAction: string;
  lastRunAt: string; // ISO datetime
  strategy: { icp: string; offer: string; hypothesis: string };
}

export type ProspectStage = PipelineStage | "rejected";

export interface EvidenceItem {
  id: string;
  claim: string;
  source: string;
  url?: string;
  observedAt: string;
}

export interface Prospect {
  id: string;
  endeavourId: string;
  score: number; // 0-100
  scoreFactors: { label: string; weight: number; note: string; evidenceIds: string[] }[];
  person: string;
  role: string;
  company: string;
  segment: string;
  trigger: string;
  evidence: EvidenceItem[];
  fitFactors: string[];
  stage: ProspectStage;
  lastTouch: string | null;
  nextAction: string;
  opportunityValue: number | null;
  status: "DISCOVERED" | "RESEARCHING" | "QUALIFIED" | "REJECTED" | "NEEDS_REVIEW";
}

export interface Message {
  id: string;
  threadId: string;
  author: "AGENT" | "HUMAN" | "PROSPECT";
  draft: boolean;
  /** Outbound lifecycle state; null for inbound messages. */
  sendState: OutboundState | null;
  sentAt: string;
  body: string;
}

export interface Thread {
  id: string;
  endeavourId: string;
  prospectId: string;
  subject: string;
  channel: "EMAIL";
  unread: boolean;
  lastActivityAt: string;
  intent: string;
  objections: string[];
  suggestedResponse: string;
  messages: Message[];
}

export type ActivityKind =
  | "RESEARCHED"
  | "QUALIFIED"
  | "DRAFTED"
  | "SENT"
  | "REPLY_RECEIVED"
  | "FOLLOWUP_DUE"
  | "MEETING_SET"
  | "WON"
  | "RUN_FAILED";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  endeavourId: string;
  subject: string;
  detail: string;
}

export type OutboundState =
  | "drafted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "queued"
  | "sending"
  | "sent"
  | "failed";

export type ApprovalKind =
  | "OUTREACH_DRAFT"
  | "REPLY_APPROVAL"
  | "HOT_LEAD"
  | "PRICING_DECISION"
  | "THREAD_MAPPING"
  | "FAILED_RUN";

export interface Approval {
  id: string;
  endeavourId: string;
  kind: ApprovalKind;
  /** What the decision acts on: a draft message, a thread, a prospect, a run or an opportunity. */
  subjectType: "message" | "thread" | "prospect" | "run" | "opportunity";
  subjectId: string;
  prospectId: string | null;
  title: string;
  recipient: string;
  why: string;
  copy: string;
  value: number | null;
  evidence: EvidenceItem[];
  createdAt: string;
}

export interface Insight {
  id: string;
  endeavourId: string;
  type: "OBSERVATION" | "RECOMMENDATION";
  statement: string;
  evidence: string;
  confidence: number;
  createdAt: string;
}

/** One row of performance, cut by whichever dimension it belongs to. */
export interface PerformanceSlice {
  dimension: "segment" | "trigger" | "source" | "message_version" | "offer";
  label: string;
  sent: number;
  replies: number;
  positiveReplies: number;
  meetings: number;
  wins: number;
  revenue: number;
}

export interface Experiment {
  id: string;
  name: string;
  variantA: string;
  variantB: string;
  resultA: string;
  resultB: string;
  status: "RUNNING" | "CONCLUDED";
}

export interface ObjectionCluster {
  label: string;
  count: number;
  example: string;
}

export interface Opportunity {
  id: string;
  endeavourId: string;
  name: string;
  company: string;
  stage: PipelineStage;
  value: number;
  probability: number;
  nextAction: string;
  updatedAt: string;
}

export interface RunLogLine {
  id: string;
  at: string;
  level: "INFO" | "WARN" | "ERROR";
  text: string;
}

export interface AgentRun {
  id: string;
  endeavourId: string;
  /** Step the run is on, e.g. "research" or "done". */
  phase: string;
  startedAt: string;
  durationMs: number;
  state: "OK" | "FAILED" | "RUNNING";
  discovered: number;
  qualified: number;
  drafted: number;
  sent: number;
}

export interface InterfaceEvent {
  id: string;
  at: string;
  direction: "IN" | "OUT";
  type: string;
  payloadSummary: string;
}

export interface SystemInterface {
  id: string;
  name: string;
  status: "NOT_CONNECTED" | "INTERFACE_READY" | "ACTIVE" | "READY";
  endpoint: string;
  schema: string;
  eventTypes: string[];
  inbound: number;
  outbound: number;
  lastEventAt: string | null;
  events: InterfaceEvent[];
}

/** Which channel notifications leave by. The address itself is never sent to the browser. */
export interface NotifyChannelStatus {
  channel: "slack" | "ntfy" | "webhook" | "in_app";
  /** The host it delivers to, for recognising a misconfiguration; never the secret path. */
  destination: string | null;
}

/** The model choice and what it has cost, in pence so the UI never does currency maths. */
export interface BudgetStatus {
  model: string;
  monthlyBudgetPence: number;
  dailyAllowancePence: number;
  spentTodayPence: number;
  spentMonthPence: number;
  remainingTodayPence: number;
  allowed: boolean;
  reason: "ok" | "daily_budget_spent" | "monthly_budget_spent" | "no_budget";
  /** The dollars-to-pounds assumption these figures were converted with. */
  usdPerGbp: number;
}

export interface SystemStatus {
  agent: AgentState;
  lastRunAt: string;
  db: "LOCAL" | "REMOTE";
  model: string;
  provider: string;
  autonomy: AutonomyLevel;
  researchSources: string[];
  notifications: NotifyChannelStatus;
  budget: BudgetStatus;
}

export interface Mailbox {
  id: string;
  address: string;
  displayName: string;
  provider: "google";
  status: "connected" | "needs_reauth" | "disconnected";
  dailyCap: number;
  /** Cap after warm-up for today. */
  capToday: number;
  sentToday: number;
  warmingUp: boolean;
  quietHours: string;
  /** Editable limits, shared by every endeavour on the mailbox. */
  limits: {
    dailyCap: number;
    weeklyCap: number;
    warmup: { startedOn: string; startCap: number; incrementPerDay: number } | null;
    quietHours: { start: number; end: number };
    timezone: string;
  };
  /** Endeavours sending through this mailbox; caps are shared between them. */
  endeavourIds: string[];
  /** Addresses this account may also send as. They share the account's caps. */
  aliases: { address: string; displayName: string }[];
  /** True when this connection was granted the consent needed to create an address. */
  canCreateAliases: boolean;
}

/** One day's brief, with the run that produced it. */
export interface BriefRecord {
  runId: string;
  endeavourId: string;
  date: string;
  brief: DailyBrief;
}

export interface DailyBrief {
  date: string;
  changed: string[];
  learned: string[];
  today: string[];
  risks: string[];
}
