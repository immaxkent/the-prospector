import { createFileRoute } from "@tanstack/react-router";
import { useDataset } from "@/data/store";
import type { PerformanceSlice } from "@/data/types";
import {
  EmptyState,
  LedgerTable,
  MachineLabel,
  Meter,
  PageHeader,
  Panel,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/os/primitives";
import { pct, stamp } from "@/lib/format";

export const Route = createFileRoute("/intelligence")({
  head: () => ({
    meta: [
      { title: "Intelligence — CBO OS" },
      {
        name: "description",
        content: "Performance by segment, offer and message version, objection clusters, running experiments and evidence-backed recommendations.",
      },
      { property: "og:title", content: "Intelligence — CBO OS" },
      { property: "og:description", content: "The learning surface: what is working, with the evidence behind it." },
    ],
  }),
  component: IntelligenceScreen,
});

/** Every cut the read model produces, in the order an operator reads them. */
const DIMENSIONS = [
  { dimension: "segment", title: "PERFORMANCE BY SEGMENT", column: "Segment" },
  { dimension: "offer", title: "PERFORMANCE BY OFFER", column: "Offer" },
  { dimension: "message_version", title: "PERFORMANCE BY MESSAGE VERSION", column: "Version" },
  { dimension: "trigger", title: "PERFORMANCE BY TRIGGER", column: "Trigger" },
  { dimension: "source", title: "PERFORMANCE BY SOURCE", column: "Source" },
] as const;

/** Rates are shown against their denominator: a rate with no sends is shown as no sends. */
function PerformancePanel({ title, column, rows }: { title: string; column: string; rows: readonly PerformanceSlice[] }) {
  return (
    <Panel title={title}>
      <LedgerTable>
        <thead>
          <tr>
            <Th>{column}</Th>
            <Th align="right">Sent</Th>
            <Th align="right">Replies</Th>
            <Th align="right">Reply rate</Th>
            <Th align="right">Positive</Th>
            <Th align="right">Meetings</Th>
            <Th align="right">Wins</Th>
            <Th>Reply rate distribution</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <Tr key={s.label}>
              <Td>{s.label}</Td>
              <Td align="right" mono>
                {s.sent}
              </Td>
              <Td align="right" mono>
                {s.replies}
              </Td>
              <Td align="right" mono className={s.sent > 0 && s.replies / s.sent > 0.15 ? "text-signal" : undefined}>
                {s.sent === 0 ? "—" : pct(s.replies / s.sent, 1)}
              </Td>
              <Td align="right" mono>
                {s.positiveReplies}
              </Td>
              <Td align="right" mono>
                {s.meetings}
              </Td>
              <Td align="right" mono>
                {s.wins}
              </Td>
              <Td className="w-[220px]">
                <Meter value={s.sent === 0 ? 0 : s.replies / s.sent} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </LedgerTable>
    </Panel>
  );
}

function IntelligenceScreen() {
  const { performance, insights, experiments, objections, isEmpty } = useDataset();

  if (isEmpty) {
    return (
      <div className="space-y-5">
        <PageHeader title="INTELLIGENCE" />
        <EmptyState
          title="NOT ENOUGH DATA TO LEARN FROM"
          body="Performance slices, objection clusters and recommendations appear once outreach has been sent and replies recorded."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="INTELLIGENCE"
        summary="Every statement below is derived from recorded sends, replies and outcomes — no modelled estimates."
      />

      {DIMENSIONS.map(({ dimension, title, column }) => {
        const rows = performance.filter((p) => p.dimension === dimension);
        if (rows.length === 0) return null;
        return <PerformancePanel key={dimension} title={title} column={column} rows={rows} />;
      })}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="OBSERVATIONS & RECOMMENDATIONS" bodyClassName="divide-y divide-border">
          {insights.map((i) => (
            <div key={i.id} className="px-4 py-3.5">
              <div className="flex items-center justify-between">
                <Tag tone={i.type === "RECOMMENDATION" ? "signal" : "neutral"}>{i.type}</Tag>
                <MachineLabel>CONFIDENCE {pct(i.confidence)}</MachineLabel>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed">{i.statement}</p>
              <p className="machine mt-1.5 normal-case tracking-normal">Evidence: {i.evidence}</p>
              <MachineLabel className="mt-1 block">{stamp(i.createdAt)}</MachineLabel>
            </div>
          ))}
        </Panel>

        <div className="space-y-5">
          <Panel title="OBJECTION CLUSTERS">
            <LedgerTable>
              <thead>
                <tr>
                  <Th>Cluster</Th>
                  <Th align="right">Count</Th>
                  <Th>Representative quote</Th>
                </tr>
              </thead>
              <tbody>
                {objections.map((o) => (
                  <Tr key={o.label}>
                    <Td>{o.label}</Td>
                    <Td align="right" mono>
                      {o.count}
                    </Td>
                    <Td className="text-muted-foreground">"{o.example}"</Td>
                  </Tr>
                ))}
              </tbody>
            </LedgerTable>
          </Panel>

          <Panel title="CURRENT EXPERIMENTS" bodyClassName="divide-y divide-border">
            {experiments.map((x) => (
              <div key={x.id} className="px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium">{x.name}</span>
                  <Tag tone={x.status === "RUNNING" ? "cyan" : "neutral"}>{x.status}</Tag>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="border-l-2 border-signal pl-2.5">
                    <MachineLabel>VARIANT A</MachineLabel>
                    <p className="text-[13px]">{x.variantA}</p>
                    <p className="numeral text-[13px] text-signal">{x.resultA}</p>
                  </div>
                  <div className="border-l-2 border-border pl-2.5">
                    <MachineLabel>VARIANT B</MachineLabel>
                    <p className="text-[13px]">{x.variantB}</p>
                    <p className="numeral text-[13px] text-muted-foreground">{x.resultB}</p>
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
