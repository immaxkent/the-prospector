import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
  EvidenceChip,
  LedgerTable,
  MachineLabel,
  MetricCell,
  PageHeader,
  Panel,
  RunIndicator,
  StatusDot,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/os/primitives";
import { clockTime, stamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Research — CBO OS" },
      {
        name: "description",
        content: "Discovery queue and run log: source, trigger, evidence and qualification status for every target found.",
      },
      { property: "og:title", content: "Research — CBO OS" },
      { property: "og:description", content: "Watch the research engine work, with evidence for every claim." },
    ],
  }),
  component: ResearchScreen,
});

const STATUS_TONE = {
  DISCOVERED: "neutral",
  RESEARCHING: "cyan",
  QUALIFIED: "signal",
  REJECTED: "danger",
  NEEDS_REVIEW: "warn",
} as const;

function ResearchScreen() {
  const { prospects, runs, runLog, status, isEmpty } = useDataset();
  const [running, setRunning] = useState(false);

  const counts = (["DISCOVERED", "RESEARCHING", "QUALIFIED", "NEEDS_REVIEW", "REJECTED"] as const).map((s) => ({
    status: s,
    count: prospects.filter((p) => p.status === s).length,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="RESEARCH"
        summary={`Sources: ${status.researchSources.join(" · ")}`}
        actions={
          <Button variant="primary" onClick={() => setRunning((r) => !r)}>
            {running ? "Stop run" : "Run research"}
          </Button>
        }
      />

      <Panel
        title="RUN STATE"
        meta={
          <MachineLabel tone={running ? "signal" : "muted"}>
            {running ? "RUNNING" : status.agent} · LAST {clockTime(status.lastRunAt)}
          </MachineLabel>
        }
        bodyClassName="px-0 py-0"
      >
        <RunIndicator running={running} />
        <div className="grid grid-cols-2 gap-6 px-4 py-4 md:grid-cols-5">
          {counts.map((c) => (
            <MetricCell key={c.status} label={c.status.replace("_", " ")} value={c.count} size="sm" />
          ))}
        </div>
      </Panel>

      {isEmpty ? (
        <EmptyState
          title="RESEARCH QUEUE EMPTY"
          body="Define an endeavour and the research loop will populate this queue with discovered targets, each with a source, a trigger and evidence."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Panel title="DISCOVERY QUEUE">
            <LedgerTable>
              <thead>
                <tr>
                  <Th>Status</Th>
                  <Th>Target</Th>
                  <Th>Source</Th>
                  <Th>Trigger</Th>
                  <Th>Why it matters</Th>
                  <Th align="right">Score</Th>
                </tr>
              </thead>
              <tbody>
                {prospects.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Tag tone={STATUS_TONE[p.status]}>{p.status.replace("_", " ")}</Tag>
                    </Td>
                    <Td>
                      <div className="text-[13px] font-medium">{p.company}</div>
                      <MachineLabel>
                        {p.person} · {p.role}
                      </MachineLabel>
                    </Td>
                    <Td>
                      {p.evidence[0] ? (
                        <EvidenceChip label={p.evidence[0].source} title={stamp(p.evidence[0].observedAt)} />
                      ) : (
                        <MachineLabel>—</MachineLabel>
                      )}
                    </Td>
                    <Td className="max-w-[220px] text-muted-foreground">{p.trigger}</Td>
                    <Td className="max-w-[240px] text-muted-foreground">
                      {p.evidence[0]?.claim ?? p.fitFactors.join(", ")}
                    </Td>
                    <Td align="right" mono>
                      {p.score}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </LedgerTable>
          </Panel>

          <div className="space-y-5">
            <Panel title="RUN LOG" bodyClassName="max-h-[420px] overflow-y-auto py-1">
              <ul className="hairline-y">
                {runLog.map((l) => (
                  <li key={l.id} className="flex items-baseline gap-3 px-4 py-2">
                    <span className="numeral shrink-0 text-[11px] text-muted-foreground">{clockTime(l.at)}</span>
                    <span
                      className={cn(
                        "machine w-[46px] shrink-0",
                        l.level === "ERROR" && "text-danger",
                        l.level === "WARN" && "text-warn",
                      )}
                    >
                      {l.level}
                    </span>
                    <span className="numeral min-w-0 flex-1 text-[12px]">{l.text}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="RECENT RUNS">
              <LedgerTable>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th align="right">Found</Th>
                    <Th align="right">Qualified</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <Tr key={r.id}>
                      <Td mono>
                        {r.id}
                        <div className="machine">{stamp(r.startedAt)}</div>
                      </Td>
                      <Td align="right" mono>
                        {r.discovered}
                      </Td>
                      <Td align="right" mono>
                        {r.qualified}
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
          </div>
        </div>
      )}
    </div>
  );
}
