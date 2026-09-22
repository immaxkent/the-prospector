import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  BriefSection,
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
import { ActivityTape } from "@/components/os/ActivityTape";
import { ApprovalTicket } from "@/components/os/ApprovalTicket";
import { gbp, num, shortDate, clockTime } from "@/lib/format";

export const Route = createFileRoute("/command")({
  head: () => ({
    meta: [
      { title: "Command — CBO OS" },
      {
        name: "description",
        content:
          "Daily command surface for CBO OS: endeavour ledger, approval queue, daily brief and the agent activity tape.",
      },
      { property: "og:title", content: "Command — CBO OS" },
      {
        property: "og:description",
        content: "Are we on track, what happened, what needs a decision, what the agent does next.",
      },
    ],
  }),
  component: CommandScreen,
});

function CommandScreen() {
  const { endeavours, approvals, brief, briefs, activity, status, isEmpty } = useDataset();
  const [briefDate, setBriefDate] = useState<string | null>(null);
  // The chosen day, or the latest one when nothing is chosen.
  const shownBrief = (briefDate && briefs.find((b) => b.date === briefDate)?.brief) || brief;
  const [resolved, setResolved] = useState<string[]>([]);
  const openApprovals = approvals.filter((a) => !resolved.includes(a.id));

  const dueActions = endeavours.reduce(
    (t, e) =>
      t +
      (e.quota.outreach - e.quotaDone.outreach) +
      (e.quota.followups - e.quotaDone.followups) +
      (e.quota.newProspects - e.quotaDone.newProspects),
    0,
  );

  if (isEmpty) {
    return (
      <div className="space-y-5">
        <Header
          count={0}
          due={0}
          approvals={0}
          agent={status.agent}
          lastRun={status.lastRunAt}
        />
        {/* This screen reports on work in progress; creating that work belongs to Endeavours. */}
        <EmptyState
          title="NOTHING RUNNING YET"
          body="Command is the daily view: today's brief, what is waiting for your decision, and what the loop did overnight. It fills once an endeavour is active. Head over to Endeavours to create your first one."
          action={
            <Link to="/endeavours">
              <Button variant="primary">Go to endeavours</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header
        count={endeavours.length}
        due={dueActions}
        approvals={openApprovals.length}
        agent={status.agent}
        lastRun={status.lastRunAt}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Endeavour ledger — source: Endeavour records */}
          <Panel title="ENDEAVOUR LEDGER" meta={<MachineLabel>{endeavours.length} ACTIVE</MachineLabel>}>
            <LedgerTable>
              <thead>
                <tr>
                  <Th>Endeavour</Th>
                  <Th>Objective progress</Th>
                  <Th align="right">Pipeline</Th>
                  <Th align="right">Qualified today</Th>
                  <Th align="right">Replies</Th>
                  <Th>Next critical action</Th>
                </tr>
              </thead>
              <tbody>
                {endeavours.map((e) => {
                  const ratio = e.actualValue / e.targetValue;
                  return (
                    <Tr key={e.id}>
                      <Td>
                        <Link to="/endeavours/$id" params={{ id: e.id }} className="hover:text-signal">
                          <div className="text-[13px] font-medium">{e.name}</div>
                          <MachineLabel>
                            {e.health.replace("_", " ")} · {shortDate(e.deadline)}
                          </MachineLabel>
                        </Link>
                      </Td>
                      <Td className="min-w-[190px]">
                        <div className="numeral text-[13px]">
                          {e.unit === "GBP" ? gbp(e.actualValue) : num(e.actualValue)}
                          <span className="text-muted-foreground">
                            {" / "}
                            {e.unit === "GBP" ? gbp(e.targetValue) : num(e.targetValue)}
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <Meter
                            value={ratio}
                            tone={e.health === "BEHIND" ? "danger" : e.health === "AT_RISK" ? "warn" : "signal"}
                          />
                        </div>
                      </Td>
                      <Td align="right" mono>
                        {e.unit === "GBP" ? gbp(e.pipelineValue) : num(e.pipelineValue)}
                      </Td>
                      <Td align="right" mono>
                        {e.qualifiedToday}
                      </Td>
                      <Td align="right" mono>
                        {e.repliesToday}
                      </Td>
                      <Td className="max-w-[260px]">
                        <span className="text-[13px] text-muted-foreground">{e.nextCriticalAction}</span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </LedgerTable>
          </Panel>

          {/* Daily brief — source: DailyBrief record */}
          {shownBrief && (
            <Panel
              title="DAILY BRIEF"
              meta={
                briefs.length > 1 ? (
                  <label className="flex items-center gap-2">
                    <MachineLabel>DAY</MachineLabel>
                    <select
                      aria-label="Brief day"
                      className="rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]"
                      value={briefDate ?? briefs[0]!.date}
                      onChange={(e) => setBriefDate(e.target.value)}
                    >
                      {briefs.map((b) => (
                        <option key={b.runId} value={b.date}>
                          {shortDate(b.date)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <MachineLabel>{shortDate(shownBrief.date)}</MachineLabel>
                )
              }
              bodyClassName="px-4 py-1"
            >
              <BriefSection title="CHANGED">
                {shownBrief.changed.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </BriefSection>
              <BriefSection title="LEARNED">
                {shownBrief.learned.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </BriefSection>
              <BriefSection title="TODAY">
                {shownBrief.today.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </BriefSection>
              <BriefSection title="RISKS">
                {shownBrief.risks.map((l) => (
                  <p key={l} className="text-warn">
                    {l}
                  </p>
                ))}
              </BriefSection>
            </Panel>
          )}

          {/* Activity tape — source: activity queue */}
          <Panel title="ACTIVITY TAPE" meta={<MachineLabel>MACHINE FEED</MachineLabel>} bodyClassName="py-1">
            <ActivityTape events={activity} />
          </Panel>
        </div>

        {/* Critical queue — source: approval queue */}
        <div className="space-y-5">
          <Panel
            title="CRITICAL QUEUE"
            meta={
              <MachineLabel tone={openApprovals.length ? "signal" : "muted"}>
                {openApprovals.length} REQUIRE HUMAN
              </MachineLabel>
            }
            bodyClassName="max-h-[720px] overflow-y-auto"
          >
            {openApprovals.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <MachineLabel>QUEUE CLEAR</MachineLabel>
              </div>
            ) : (
              openApprovals.map((a) => (
                <ApprovalTicket
                  key={a.id}
                  approval={a}
                  endeavourName={endeavours.find((e) => e.id === a.endeavourId)?.name}
                  onResolve={(id) => setResolved((r) => [...r, id])}
                />
              ))
            )}
          </Panel>

          <Panel title="TODAY'S QUOTA" bodyClassName="divide-y divide-border">
            {endeavours.map((e) => (
              <div key={e.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px]">{e.name}</span>
                  <Tag tone={e.health === "ON_TRACK" ? "signal" : e.health === "AT_RISK" ? "warn" : "danger"}>
                    {e.health.replace("_", " ")}
                  </Tag>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <MetricCell
                    size="sm"
                    label="PROSPECTS"
                    value={`${e.quotaDone.newProspects}/${e.quota.newProspects}`}
                  />
                  <MetricCell size="sm" label="OUTREACH" value={`${e.quotaDone.outreach}/${e.quota.outreach}`} />
                  <MetricCell size="sm" label="FOLLOW-UPS" value={`${e.quotaDone.followups}/${e.quota.followups}`} />
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Header({
  count,
  due,
  approvals,
  agent,
  lastRun,
}: {
  count: number;
  due: number;
  approvals: number;
  agent: string;
  lastRun: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="display text-[30px] font-medium leading-none">Command</h1>
          <span className="machine inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 backdrop-blur">
            <StatusDot tone={agent === "ERROR" ? "error" : "ok"} live />
            AGENT {agent} · LAST RUN {clockTime(lastRun)}
          </span>
        </div>
        <p className="mt-3 text-[14px] text-muted-foreground">
          {count} active {count === 1 ? "Endeavour" : "Endeavours"} · {due} actions due · {approvals} require approval
        </p>
      </div>
    </div>
  );
}
