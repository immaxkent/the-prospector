/**
 * CBO OS domain model.
 * Every value rendered in the UI originates from one of these records.
 */

export type AgentState = "ONLINE" | "RUNNING" | "WAITING" | "ERROR";
export type AutonomyLevel = "MANUAL" | "SUGGEST" | "SEMI_AUTO" | "AUTO";
export type Health = "ON_TRACK" | "AT_RISK" | "BEHIND" | "PAUSED";

export type PipelineStage =
  | "researched"
  | "qualified"
  | "contacted"
  | "replied"
  | "meeting"
  | "proposal"
  | "won";

export interface Endeavour {
  id: string;
  name: string;
  objective: string;
  unit: "GBP" | "COUNT";
  targetValue: number;
  actualValue: number;
  pipelineValue: number;
  deadline: string; // ISO date
  horizonDays: number;
  health: Health;
  autonomy: AutonomyLevel;
  audienceNotes: string;
  offerNotes: string;
  channels: string[];
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
  claim: string;
  source: string;
  url?: string;
  observedAt: string;
}

export interface Prospect {
  id: string;
  endeavourId: string;
  score: number; // 0-100
  scoreFactors: { label: string; weight: number; note: string }[];
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
  sentAt: string;
  body: string;
}

export interface Thread {
  id: string;
  endeavourId: string;
  prospectId: string;
  subject: string;
  channel: "EMAIL" | "LINKEDIN" | "TELEGRAM";
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

export interface Approval {
  id: string;
  endeavourId: string;
  kind: "REPLY_APPROVAL" | "HOT_LEAD" | "PRICING_DECISION" | "FAILED_RUN";
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

export interface SegmentPerformance {
  segment: string;
  sent: number;
  replies: number;
  meetings: number;
  wins: number;
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

export interface SystemStatus {
  agent: AgentState;
  lastRunAt: string;
  db: "LOCAL" | "REMOTE";
  model: string;
  provider: string;
  autonomy: AutonomyLevel;
  sendCapPerDay: number;
  quietHours: string;
  researchSources: string[];
  emailConnected: boolean;
}

export interface DailyBrief {
  date: string;
  changed: string[];
  learned: string[];
  today: string[];
  risks: string[];
}
