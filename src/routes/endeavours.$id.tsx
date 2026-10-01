import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useDataset, useStatTiles } from "@/data/store";
import {
  Button,
  EmptyState,
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
import { EndeavourMailboxSelect } from "@/components/os/EndeavourMailboxSelect";
import { StatTiles } from "@/components/os/StatTiles";
import { ReviewList } from "@/components/os/ReviewList";
import { ResolveList } from "@/components/os/ResolveList";
import { DeleteEndeavour } from "@/components/os/DeleteEndeavour";
import { AgentOrb } from "@/components/os/AgentOrb";
import { RunNowControl } from "@/components/os/RunNowControl";
import { SectionRail, useSectionSpy } from "@/components/os/SectionRail";
import { ActivityChart, FunnelChart } from "@/components/os/charts";
import { dailyActivity, isQuiet } from "@/data/chart-series";
import { EndeavourConfig } from "@/components/os/EndeavourConfig";
import { SegmentShares } from "@/components/os/SegmentShares";
import { StrategyEditor } from "@/components/os/StrategyEditor";
import { daysUntil, gbp, num, pct, scoreText, shortDate, stamp } from "@/lib/format";
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

/**
 * The endeavour reads top to bottom, in the order the work happens: what the numbers say,
 * who was found, what was sent, what it is all for. Tabs hid seven of these eight behind a
 * click, which is why approvals and runs were hard to find — you had to already know they
 * were there to go looking.
 */
const SECTIONS = [
  { id: "overview", label: "OVERVIEW" },
  { id: "review", label: "REVIEW" },
  { id: "prospects", label: "PROSPECTS" },
  { id: "pipeline", label: "PIPELINE" },
  { id: "outreach", label: "OUTREACH" },
  { id: "strategy", label: "STRATEGY" },
  { id: "configuration", label: "CONFIGURATION" },
  { id: "intelligence", label: "INTELLIGENCE" },
  { id: "runs", label: "RUNS" },
] as const;

const SECTION_IDS = SECTIONS.map((s) => s.id);

const STAGES: PipelineStage[] = ["researched", "qualified", "contacted", "replied", "meeting", "proposal", "won"];

function EndeavourDetail() {
  const { id } = Route.useParams();
  const { endeavours, prospects, opportunities, insights, approvals, runs, threads, status } = useDataset();
  const statTiles = useStatTiles();
  const active = useSectionSpy(SECTION_IDS);
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
  // One clock for the whole row, so two tiles cannot disagree about what day it is.
  const statContext = { endeavour: e, budget: status.budget, now: new Date(), ...mine };
  const activity = dailyActivity(mine.threads, statContext.now);
  /*
   * Silent for a fortnight, and still live.
   *
   * The same fortnight the weekly review asks about, so the screen it links to shows the
   * same prospects. Nothing here is moved — the list is the question, and the operator is
   * the only one who answers it.
   */
  const quiet = mine.prospects.filter((p) => {
    if (["won", "lost", "nurture"].includes(p.stage)) return false;
    if (!p.lastTouch) return false;
    return statContext.now.getTime() - new Date(p.lastTouch).getTime() >= 14 * 86_400_000;
  });

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
            {/*
              Whether the agent is alive, and the button that wakes it, side by side. The
              run is scoped to this endeavour: a global one on a page about a single
              endeavour runs three others without saying so.
            */}
            <div className="flex flex-wrap items-center gap-4 rounded-[10px] border border-border px-3 py-2">
              <AgentOrb runs={mine.runs} />
              <RunNowControl endeavourId={e.id} />
            </div>
            <EndeavourMailboxSelect endeavour={e} />
            <EndeavourStatusControls endeavour={e} />
          </div>
        </div>
      </div>

      <Section id="overview" label="OVERVIEW">
        <StatTiles tiles={statTiles} ctx={statContext} />
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

            <Panel title="FUNNEL" meta={<MachineLabel>WHERE IT LEAKS</MachineLabel>} bodyClassName="px-4 py-4">
              <FunnelChart stages={STAGES.map((s) => ({ label: s, value: e.funnel[s] }))} />
            </Panel>

            <Panel
              title="ACTIVITY"
              meta={<MachineLabel>LAST 14 DAYS</MachineLabel>}
              bodyClassName="px-4 py-4"
            >
              {isQuiet(activity) ? (
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  Nothing has gone out in the last fortnight.
                </p>
              ) : (
                <ActivityChart days={activity} />
              )}
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
      </Section>

      <Section id="review" label="REVIEW">
        <Panel
          title="WAITING ON YOU"
          meta={<MachineLabel>NOTHING IS DRAFTED UNTIL YOU RELEASE IT</MachineLabel>}
          bodyClassName="px-4 py-4"
        >
          <ReviewList endeavourId={e.id} prospects={mine.prospects} />
        </Panel>

        {/* The other half of the review: what to clear out. Nothing leaves the buffer on
            its own, so this is where the weekly review's "update on these" lands. */}
        <Panel
          title="GONE QUIET"
          meta={<MachineLabel>NOTHING LEAVES THE LIST UNTIL YOU SAY SO</MachineLabel>}
          bodyClassName="p-0"
        >
          <ResolveList
            endeavourId={e.id}
            prospects={quiet}
            emptyNote="Nothing has gone quiet. Anything silent for a fortnight will appear here and in the weekly review."
          />
        </Panel>
      </Section>

      <Section id="prospects" label="PROSPECTS">
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
                    {scoreText(p.score)}
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
      </Section>

      <Section id="pipeline" label="PIPELINE">
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
      </Section>

      <Section id="outreach" label="OUTREACH">
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
      </Section>

      <Section id="strategy" label="STRATEGY">
        <Panel title="STRATEGY" meta={<MachineLabel>EVERY CHANGE IS A NEW VERSION WITH A REASON</MachineLabel>} bodyClassName="p-0">
          <StrategyEditor endeavourId={e.id} />
        </Panel>
      </Section>

      <Section id="configuration" label="CONFIGURATION">
        <Panel
          title="CONFIGURATION"
          meta={<MachineLabel>PACING, NOT STRATEGY: THESE CHANGES ARE NOT VERSIONED</MachineLabel>}
          bodyClassName="p-0"
        >
          <EndeavourConfig endeavour={e} />
        </Panel>

        <Panel
          title="SEGMENT SHARES"
          meta={
            <MachineLabel>
              {e.pendingProspects}/{e.settings.prospecting.maximumPending} PENDING · {e.activeConversations} LIVE
            </MachineLabel>
          }
          bodyClassName="p-0"
        >
          <SegmentShares endeavour={e} />
        </Panel>

        {/* Kept away from Pause and Archive: a destructive action beside a routine one
            gets pressed by accident eventually. */}
        <Panel title="DANGER" bodyClassName="px-4 py-4">
          <DeleteEndeavour endeavour={e} />
        </Panel>
      </Section>

      <Section id="intelligence" label="INTELLIGENCE">
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
      </Section>

      <Section id="runs" label="RUNS">
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
      </Section>
      <SectionRail sections={SECTIONS} active={active} />
    </div>
  );
}

/**
 * One band of the page. The heading is the anchor the rail scrolls to and the thing the
 * observer watches, so it carries the id rather than a wrapper around it.
 */
function Section({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    // The id is on the section, not the heading: it is both what an anchor jumps to and
    // what the spy watches, and scroll-mt clears the sticky header so a jump does not land
    // underneath it.
    <section id={id} data-section={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 space-y-5 pt-6">
      <h2 id={`${id}-heading`} className="machine text-foreground/45">
        {label}
      </h2>
      {children}
    </section>
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
