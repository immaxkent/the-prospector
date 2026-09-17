import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
  LedgerTable,
  MachineLabel,
  MetricCell,
  Meter,
  PageHeader,
  Panel,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/os/primitives";
import { gbp, pct, stamp } from "@/lib/format";
import type { PipelineStage } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — CBO OS" },
      {
        name: "description",
        content: "Institutional deal tracking: stage matrix with counts, value and conversion plus an opportunity ledger.",
      },
      { property: "og:title", content: "Pipeline — CBO OS" },
      { property: "og:description", content: "Stage matrix and opportunity ledger, not a colourful kanban." },
    ],
  }),
  component: PipelineScreen,
});

const STAGES: PipelineStage[] = ["researched", "qualified", "contacted", "replied", "meeting", "proposal", "won"];

function PipelineScreen() {
  const { opportunities, endeavours, isEmpty } = useDataset();
  const [view, setView] = useState<"MATRIX" | "BOARD">("MATRIX");

  const totalValue = opportunities.reduce((t, o) => t + o.value, 0);
  const weighted = opportunities.reduce((t, o) => t + o.value * o.probability, 0);
  const meetings = opportunities.filter((o) => o.stage === "meeting").length;
  const proposals = opportunities.filter((o) => o.stage === "proposal").length;
  const wins = opportunities.filter((o) => o.stage === "won").length;
  const targetTotal = endeavours
    .filter((e) => e.unit === "GBP")
    .reduce((t, e) => t + e.targetValue, 0);

  if (isEmpty) {
    return (
      <div className="space-y-5">
        <PageHeader title="PIPELINE" />
        <EmptyState
          title="NO OPEN OPPORTUNITIES"
          body="Opportunities are created when a prospect reaches the contacted stage and a value is attached."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="PIPELINE"
        summary="Stage-level coverage against open objectives, sourced from opportunity records."
        actions={
          <div className="flex gap-1">
            {(["MATRIX", "BOARD"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "machine rounded-[3px] border px-2 py-1.5",
                  view === v ? "border-signal bg-signal-soft text-primary" : "border-border hover:bg-accent",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />

      <Panel bodyClassName="grid grid-cols-2 gap-6 px-4 py-4 md:grid-cols-6">
        <MetricCell label="PIPELINE VALUE" value={gbp(totalValue)} />
        <MetricCell label="WEIGHTED" value={gbp(Math.round(weighted))} tone="signal" />
        <MetricCell label="MEETINGS" value={meetings} />
        <MetricCell label="PROPOSALS" value={proposals} />
        <MetricCell label="WINS" value={wins} />
        <MetricCell
          label="OBJECTIVE COVERAGE"
          value={targetTotal ? pct(totalValue / targetTotal) : "—"}
          sub={`AGAINST ${gbp(targetTotal)} OF GBP TARGETS`}
        />
      </Panel>

      {view === "MATRIX" ? (
        <Panel title="STAGE MATRIX">
          <LedgerTable>
            <thead>
              <tr>
                <Th>Stage</Th>
                <Th align="right">Count</Th>
                <Th align="right">Value</Th>
                <Th align="right">Weighted</Th>
                <Th align="right">Conversion to next</Th>
                <Th>Distribution</Th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((s, i) => {
                const inStage = opportunities.filter((o) => o.stage === s);
                const value = inStage.reduce((t, o) => t + o.value, 0);
                const w = inStage.reduce((t, o) => t + o.value * o.probability, 0);
                const nextStage = STAGES[i + 1];
                const nextCount = nextStage ? opportunities.filter((o) => o.stage === nextStage).length : 0;
                return (
                  <Tr key={s}>
                    <Td>
                      <Tag tone={s === "won" ? "signal" : "neutral"}>{s}</Tag>
                    </Td>
                    <Td align="right" mono>
                      {inStage.length}
                    </Td>
                    <Td align="right" mono>
                      {gbp(value)}
                    </Td>
                    <Td align="right" mono>
                      {gbp(Math.round(w))}
                    </Td>
                    <Td align="right" mono className="text-muted-foreground">
                      {nextStage && inStage.length ? pct(nextCount / inStage.length) : "—"}
                    </Td>
                    <Td className="w-[220px]">
                      <Meter value={totalValue ? value / totalValue : 0} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </LedgerTable>
        </Panel>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          {STAGES.map((s) => (
            <Panel key={s} title={s.toUpperCase()} bodyClassName="space-y-2 p-2">
              {opportunities
                .filter((o) => o.stage === s)
                .map((o) => (
                  <div key={o.id} className="rounded-[3px] border border-border px-2.5 py-2">
                    <div className="text-[13px]">{o.company}</div>
                    <div className="machine mt-1">{o.name}</div>
                    <div className="numeral mt-1 text-[13px]">{gbp(o.value)}</div>
                  </div>
                ))}
            </Panel>
          ))}
        </div>
      )}

      <Panel title="OPPORTUNITY LEDGER">
        <LedgerTable>
          <thead>
            <tr>
              <Th>Opportunity</Th>
              <Th>Endeavour</Th>
              <Th>Stage</Th>
              <Th align="right">Value</Th>
              <Th align="right">Probability</Th>
              <Th>Next action</Th>
              <Th align="right">Updated</Th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <Tr key={o.id}>
                <Td>
                  <div className="text-[13px] font-medium">{o.name}</div>
                  <MachineLabel>{o.company}</MachineLabel>
                </Td>
                <Td className="text-muted-foreground">
                  {endeavours.find((e) => e.id === o.endeavourId)?.name ?? "—"}
                </Td>
                <Td>
                  <Tag tone={o.stage === "won" ? "signal" : "neutral"}>{o.stage}</Tag>
                </Td>
                <Td align="right" mono>
                  {gbp(o.value)}
                </Td>
                <Td align="right" mono>
                  {pct(o.probability)}
                </Td>
                <Td className="text-muted-foreground">{o.nextAction}</Td>
                <Td align="right" mono className="text-muted-foreground">
                  {stamp(o.updatedAt)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </LedgerTable>
      </Panel>
    </div>
  );
}
