import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
  FunnelStrip,
  LedgerTable,
  MachineLabel,
  MetricCell,
  Meter,
  Panel,
  StatusDot,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/os/primitives";
import { ApprovalTicket } from "@/components/os/ApprovalTicket";
import { EndeavourStatusControls } from "@/components/os/EndeavourStatusControls";
import { gbp, num, pct, shortDate, stamp, daysUntil } from "@/lib/format";
import type { PipelineStage } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/endeavours/$id")({
  head: () => ({
    meta: [
      { title: "Endeavour detail — CBO OS" },
      {
        name: "description",
        content: "Objective progress, funnel, quota, strategy, learning and agent runs for a single endeavour.",
      },
      { property: "og:title", content: "Endeavour detail — CBO OS" },
      { property: "og:description", content: "Open an endeavour like a trading book: state, strategy and runs." },
    ],
  }),
  component: EndeavourDetail,
});

const TABS = ["OVERVIEW", "PROSPECTS", "PIPELINE", "OUTREACH", "STRATEGY", "INTELLIGENCE", "RUNS"] as const;
type Tab = (typeof TABS)[number];

const STAGES: PipelineStage[] = ["researched", "qualified", "contacted", "replied", "meeting", "proposal", "won"];

function EndeavourDetail() {
  const { id } = Route.useParams();
  const { endeavours, prospects, opportunities, insights, approvals, runs, threads } = useDataset();
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const e = endeavours.find((x) => x.id === id);

  if (!e) {
    return (
      <EmptyState
        title="ENDEAVOUR NOT FOUND"
        body="This endeavour no longer exists in the local database."
        action={
          <Link to="/endeavours">
            <Button variant="primary">Back to endeavours</Button>
          </Link>
        }
      />
    );
  }

  const mine = {
    prospects: prospects.filter((p) => p.endeavourId === e.id),
    opportunities: opportunities.filter((o) => o.endeavourId === e.id),
    insights: insights.filter((i) => i.endeavourId === e.id),
    approvals: approvals.filter((a) => a.endeavourId === e.id),
    runs: runs.filter((r) => r.endeavourId === e.id),
    threads: threads.filter((t) => t.endeavourId === e.id),
  };

  const gap = e.targetValue - e.actualValue;

  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <MachineLabel>
              ENDEAVOUR · {e.id.toUpperCase()} · {e.autonomy}
            </MachineLabel>
            <h1 className="mt-1 text-[24px] font-medium tracking-tight">{e.name}</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">{e.objective}</p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <EndeavourStatusControls endeavour={e} />
            <MetricCell
              label="OBJECTIVE"
              size="lg"
              value={e.unit === "GBP" ? gbp(e.actualValue) : num(e.actualValue)}
              sub={`TARGET ${e.unit === "GBP" ? gbp(e.targetValue) : num(e.targetValue)} · GAP ${
                e.unit === "GBP" ? gbp(gap) : num(gap)
              }`}
            />
            <MetricCell
              label="HORIZON"
              size="lg"
              value={`${daysUntil(e.deadline)}d`}
              sub={shortDate(e.deadline)}
              tone={daysUntil(e.deadline) < 15 ? "warn" : "default"}
            />
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "machine border-b-2 px-3 py-2",
                tab === t ? "border-signal text-foreground" : "border-transparent hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === "OVERVIEW" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5">
            <Panel title="OBJECTIVE PROGRESS" bodyClassName="px-4 py-4">
              <div className="flex items-end gap-8">
                <MetricCell
                  label="ACTUAL"
                  value={e.unit === "GBP" ? gbp(e.actualValue) : num(e.actualValue)}
                  tone="signal"
                />
                <MetricCell label="TARGET" value={e.unit === "GBP" ? gbp(e.targetValue) : num(e.targetValue)} />
                <MetricCell label="REMAINING GAP" value={e.unit === "GBP" ? gbp(gap) : num(gap)} tone="warn" />
                <MetricCell label="PIPELINE" value={e.unit === "GBP" ? gbp(e.pipelineValue) : num(e.pipelineValue)} />
                <MetricCell label="COVERAGE" value={pct(e.pipelineValue / e.targetValue)} />
              </div>
              <div className="mt-4">
                <Meter value={e.actualValue / e.targetValue} />
              </div>
            </Panel>

            <Panel title="FUNNEL" bodyClassName="px-4 py-4">
              <FunnelStrip stages={STAGES.map((s) => ({ label: s, value: e.funnel[s] }))} />
            </Panel>

            <Panel title="CURRENT STRATEGY" bodyClassName="divide-y divide-border">
              <Row label="ACTIVE ICP" value={e.strategy.icp} />
              <Row label="OFFER" value={e.strategy.offer} />
              <Row label="MESSAGE HYPOTHESIS" value={e.strategy.hypothesis} />
            </Panel>

            <Panel title="RECENT LEARNING" bodyClassName="divide-y divide-border">
              {mine.insights.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <MachineLabel>NO LEARNING RECORDED</MachineLabel>
                </div>
              ) : (
                mine.insights.map((i) => (
                  <div key={i.id} className="px-4 py-3">
                    <Tag tone={i.type === "RECOMMENDATION" ? "signal" : "neutral"}>{i.type}</Tag>
                    <p className="mt-1.5 text-[14px]">{i.statement}</p>
                    <p className="machine mt-1">EVIDENCE: {i.evidence}</p>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="TODAY'S QUOTA" bodyClassName="grid grid-cols-3 gap-3 px-4 py-4">
              <MetricCell
                label="NEW PROSPECTS"
                value={`${e.quotaDone.newProspects}/${e.quota.newProspects}`}
                size="sm"
              />
              <MetricCell label="NEW OUTREACH" value={`${e.quotaDone.outreach}/${e.quota.outreach}`} size="sm" />
              <MetricCell label="FOLLOW-UPS" value={`${e.quotaDone.followups}/${e.quota.followups}`} size="sm" />
            </Panel>

            <Panel title="NEXT ACTIONS & APPROVALS" bodyClassName="max-h-[560px] overflow-y-auto">
              {mine.approvals.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <MachineLabel>NOTHING AWAITING DECISION</MachineLabel>
                </div>
              ) : (
                mine.approvals.map((a) => <ApprovalTicket key={a.id} approval={a} />)
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "PROSPECTS" && (
        <Panel title={`PROSPECTS · ${mine.prospects.length}`}>
          <LedgerTable>
            <thead>
              <tr>
                <Th align="right">Score</Th>
                <Th>Person</Th>
                <Th>Company</Th>
                <Th>Stage</Th>
                <Th>Next action</Th>
              </tr>
            </thead>
            <tbody>
              {mine.prospects.map((p) => (
                <Tr key={p.id}>
                  <Td align="right" mono>
                    {p.score}
                  </Td>
                  <Td>{p.person}</Td>
                  <Td>{p.company}</Td>
                  <Td>
                    <Tag>{p.stage}</Tag>
                  </Td>
                  <Td className="text-muted-foreground">{p.nextAction}</Td>
                </Tr>
              ))}
            </tbody>
          </LedgerTable>
        </Panel>
      )}

      {tab === "PIPELINE" && (
        <Panel title="OPPORTUNITY LEDGER">
          <LedgerTable>
            <thead>
              <tr>
                <Th>Opportunity</Th>
                <Th>Stage</Th>
                <Th align="right">Value</Th>
                <Th align="right">Probability</Th>
                <Th>Next action</Th>
              </tr>
            </thead>
            <tbody>
              {mine.opportunities.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    {o.name}
                    <div className="machine">{o.company}</div>
                  </Td>
                  <Td>
                    <Tag>{o.stage}</Tag>
                  </Td>
                  <Td align="right" mono>
                    {gbp(o.value)}
                  </Td>
                  <Td align="right" mono>
                    {pct(o.probability)}
                  </Td>
                  <Td className="text-muted-foreground">{o.nextAction}</Td>
                </Tr>
              ))}
            </tbody>
          </LedgerTable>
        </Panel>
      )}

      {tab === "OUTREACH" && (
        <Panel title="THREADS" bodyClassName="divide-y divide-border">
          {mine.threads.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MachineLabel>NO OUTREACH SENT</MachineLabel>
            </div>
          ) : (
            mine.threads.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px]">{t.subject}</span>
                  <MachineLabel>
                    {t.channel} · {stamp(t.lastActivityAt)}
                  </MachineLabel>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">INTENT: {t.intent}</p>
              </div>
            ))
          )}
        </Panel>
      )}

      {tab === "STRATEGY" && (
        <Panel bodyClassName="divide-y divide-border">
          <Row label="ACTIVE ICP" value={e.strategy.icp} />
          <Row label="OFFER" value={e.strategy.offer} />
          <Row label="MESSAGE HYPOTHESIS" value={e.strategy.hypothesis} />
          <Row label="AUDIENCE NOTES" value={e.audienceNotes} />
          <Row label="OFFER NOTES" value={e.offerNotes} />
          <Row label="CHANNELS" value={e.channels.join(" · ")} />
          <Row label="AUTONOMY" value={e.autonomy} />
        </Panel>
      )}

      {tab === "INTELLIGENCE" && (
        <Panel bodyClassName="divide-y divide-border">
          {mine.insights.map((i) => (
            <div key={i.id} className="px-4 py-3">
              <Tag tone={i.type === "RECOMMENDATION" ? "signal" : "neutral"}>{i.type}</Tag>
              <p className="mt-1.5 text-[14px]">{i.statement}</p>
              <p className="machine mt-1">
                EVIDENCE: {i.evidence} · CONFIDENCE {pct(i.confidence)}
              </p>
            </div>
          ))}
        </Panel>
      )}

      {tab === "RUNS" && (
        <Panel title="AGENT RUNS">
          <LedgerTable>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Started</Th>
                <Th align="right">Duration</Th>
                <Th align="right">Discovered</Th>
                <Th align="right">Qualified</Th>
                <Th align="right">Drafted</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {mine.runs.map((r) => (
                <Tr key={r.id}>
                  <Td mono>{r.id}</Td>
                  <Td mono>{stamp(r.startedAt)}</Td>
                  <Td align="right" mono>
                    {Math.round(r.durationMs / 1000)}s
                  </Td>
                  <Td align="right" mono>
                    {r.discovered}
                  </Td>
                  <Td align="right" mono>
                    {r.qualified}
                  </Td>
                  <Td align="right" mono>
                    {r.drafted}
                  </Td>
                  <Td>
                    <span className="machine inline-flex items-center gap-1.5">
                      <StatusDot tone={r.state === "FAILED" ? "error" : "ok"} />
                      {r.state}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </LedgerTable>
        </Panel>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 md:flex-row md:gap-6">
      <MachineLabel className="w-[190px] shrink-0 pt-1">{label}</MachineLabel>
      <p className="text-[14px] leading-relaxed">{value}</p>
    </div>
  );
}
