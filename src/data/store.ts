/**
 * DATA ACCESS LAYER.
 *
 * Every screen reads through these adapters. Swap the fixture bodies for real
 * database / API calls without touching a single component.
 *
 * Mode is persisted locally: "fixtures" (design data) or "empty" (clean install).
 */
import { useSyncExternalStore } from "react";
import type {
  ActivityEvent,
  AgentRun,
  Approval,
  DailyBrief,
  Endeavour,
  Experiment,
  Insight,
  ObjectionCluster,
  Opportunity,
  Prospect,
  RunLogLine,
  SegmentPerformance,
  SystemInterface,
  SystemStatus,
  Thread,
} from "./types";
import {
  emptyStatus,
  fixtureActivity,
  fixtureApprovals,
  fixtureBrief,
  fixtureEndeavours,
  fixtureExperiments,
  fixtureInsights,
  fixtureInterfaces,
  fixtureObjections,
  fixtureOpportunities,
  fixtureProspects,
  fixtureRunLog,
  fixtureRuns,
  fixtureSegments,
  fixtureStatus,
  fixtureThreads,
} from "./fixtures";

export type DataMode = "fixtures" | "empty";

const STORAGE_KEY = "cbo-os:data-mode";
let mode: DataMode = "fixtures";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function initDataMode() {
  if (typeof window === "undefined") return;
  const stored = window.localStorage.getItem(STORAGE_KEY) as DataMode | null;
  if (stored === "empty" || stored === "fixtures") {
    if (stored !== mode) {
      mode = stored;
      emit();
    }
  }
}

export function setDataMode(next: DataMode) {
  mode = next;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  emit();
}

export function getDataMode(): DataMode {
  return mode;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDataMode(): DataMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "fixtures" as DataMode,
  );
}

const live = () => mode === "fixtures";

/* ---- Adapters: replace bodies with real reads ---- */

export interface Dataset {
  status: SystemStatus;
  endeavours: Endeavour[];
  prospects: Prospect[];
  threads: Thread[];
  activity: ActivityEvent[];
  approvals: Approval[];
  brief: DailyBrief | null;
  opportunities: Opportunity[];
  insights: Insight[];
  segments: SegmentPerformance[];
  experiments: Experiment[];
  objections: ObjectionCluster[];
  runs: AgentRun[];
  runLog: RunLogLine[];
  interfaces: SystemInterface[];
  isEmpty: boolean;
}

export function useDataset(): Dataset {
  const m = useDataMode();
  const on = m === "fixtures";
  return {
    status: on ? fixtureStatus : emptyStatus,
    endeavours: on ? fixtureEndeavours : [],
    prospects: on ? fixtureProspects : [],
    threads: on ? fixtureThreads : [],
    activity: on ? fixtureActivity : [],
    approvals: on ? fixtureApprovals : [],
    brief: on ? fixtureBrief : null,
    opportunities: on ? fixtureOpportunities : [],
    insights: on ? fixtureInsights : [],
    segments: on ? fixtureSegments : [],
    experiments: on ? fixtureExperiments : [],
    objections: on ? fixtureObjections : [],
    runs: on ? fixtureRuns : [],
    runLog: on ? fixtureRunLog : [],
    // Interfaces describe the local architecture, not records, so they persist
    // in empty mode with their counters zeroed.
    interfaces: on
      ? fixtureInterfaces
      : fixtureInterfaces.map((i) => ({ ...i, inbound: 0, outbound: 0, lastEventAt: null, events: [] })),
    isEmpty: !on,
  };
}

export { live };

/* ---- Execution loop run state (UI state, not records) ----
 * Source: manual trigger of the daily execution loop. No agent backend is
 * connected yet, so the run reports honestly that nothing was executed. When a
 * backend exists, replace startRun() with the real call and feed phases from it.
 */

export type RunPhase = "IDLE" | "RESEARCH" | "QUALIFY" | "DRAFT" | "QUEUE" | "DONE";

export interface RunState {
  phase: RunPhase;
  startedAt: string | null;
  finishedAt: string | null;
  note: string | null;
}

let runState: RunState = { phase: "IDLE", startedAt: null, finishedAt: null, note: null };
const runListeners = new Set<() => void>();
let runTimers: ReturnType<typeof setTimeout>[] = [];

function setRun(next: RunState) {
  runState = next;
  runListeners.forEach((l) => l());
}

function subscribeRun(listener: () => void) {
  runListeners.add(listener);
  return () => runListeners.delete(listener);
}

const IDLE_RUN: RunState = { phase: "IDLE", startedAt: null, finishedAt: null, note: null };

export function useRunState(): RunState {
  return useSyncExternalStore(
    subscribeRun,
    () => runState,
    () => IDLE_RUN,
  );
}

export function startRun() {
  if (runState.phase !== "IDLE" && runState.phase !== "DONE") return;
  runTimers.forEach(clearTimeout);
  runTimers = [];
  const startedAt = new Date().toISOString();
  setRun({ phase: "RESEARCH", startedAt, finishedAt: null, note: null });

  const steps: { at: number; phase: RunPhase }[] = [
    { at: 900, phase: "QUALIFY" },
    { at: 1800, phase: "DRAFT" },
    { at: 2700, phase: "QUEUE" },
  ];
  steps.forEach((s) =>
    runTimers.push(setTimeout(() => setRun({ ...runState, phase: s.phase }), s.at)),
  );
  runTimers.push(
    setTimeout(
      () =>
        setRun({
          phase: "DONE",
          startedAt,
          finishedAt: new Date().toISOString(),
          note: "NO AGENT BACKEND CONNECTED — NOTHING WAS EXECUTED",
        }),
      3600,
    ),
  );
}

export function dismissRun() {
  runTimers.forEach(clearTimeout);
  runTimers = [];
  setRun(IDLE_RUN);
}
