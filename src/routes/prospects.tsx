import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
  EvidenceChip,
  InspectorPanel,
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
import { gbp, relative, stamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProspectActions } from "@/components/os/ProspectActions";

export const Route = createFileRoute("/prospects")({
  head: () => ({
    meta: [
      { title: "Prospects — CBO OS" },
      {
        name: "description",
        content: "Research blotter of scored prospects with trigger, evidence, stage, last touch and next action.",
      },
      { property: "og:title", content: "Prospects — CBO OS" },
      { property: "og:description", content: "A research terminal crossed with a financial blotter." },
    ],
  }),
  component: ProspectsScreen,
});

const STAGE_FILTERS = ["ALL", "researched", "qualified", "contacted", "replied", "meeting", "proposal", "won", "rejected"];

function ProspectsScreen() {
  const { prospects, endeavours, threads, isEmpty } = useDataset();
  const [stage, setStage] = useState("ALL");
  const [endeavour, setEndeavour] = useState("ALL");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derived from the dataset so the inspector reflects changes after an action.
  const selected = prospects.find((p) => p.id === selectedId) ?? null;

  const rows = useMemo(
    () =>
      prospects.filter(
        (p) =>
          (stage === "ALL" || p.stage === stage) &&
          (endeavour === "ALL" || p.endeavourId === endeavour) &&
          (q === "" ||
            `${p.person} ${p.company} ${p.segment} ${p.trigger}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [prospects, stage, endeavour, q],
  );

  const thread = selected ? threads.find((t) => t.prospectId === selected.id) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="PROSPECTS"
        summary={`${rows.length} of ${prospects.length} records · scored from trigger recency, fit factors and role authority`}
      />

      {isEmpty ? (
        <EmptyState
          title="NO PROSPECTS DISCOVERED"
          body="Prospects appear here once an endeavour is defined and the research loop has run at least once."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter person, company, trigger…"
              className="h-8 w-[260px] rounded-[3px] border border-border bg-card px-2.5 font-mono text-[12px] outline-none focus:border-signal"
            />
            <select
              value={endeavour}
              onChange={(e) => setEndeavour(e.target.value)}
              className="machine h-8 rounded-[3px] border border-border bg-card px-2"
            >
              <option value="ALL">ALL ENDEAVOURS</option>
              {endeavours.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              {STAGE_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStage(s)}
                  className={cn(
                    "machine rounded-[3px] border px-2 py-1.5",
                    stage === s ? "border-signal bg-signal-soft text-primary" : "border-border hover:bg-accent",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <Panel bodyClassName="max-h-[70vh] overflow-auto">
            <LedgerTable>
              <thead>
                <tr>
                  <Th align="right">Score</Th>
                  <Th>Person</Th>
                  <Th>Company</Th>
                  <Th>Role</Th>
                  <Th>Segment</Th>
                  <Th>Trigger</Th>
                  <Th>Evidence</Th>
                  <Th>Stage</Th>
                  <Th align="right">Last touch</Th>
                  <Th>Next action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.id} onClick={() => setSelectedId(p.id)} active={selected?.id === p.id}>
                    <Td align="right" mono className="w-[70px]">
                      <span
                        className={cn(
                          p.score >= 80 ? "text-signal" : p.score < 55 ? "text-muted-foreground" : undefined,
                        )}
                      >
                        {p.score}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap font-medium">{p.person}</Td>
                    <Td className="whitespace-nowrap">{p.company}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{p.role}</Td>
                    <Td className="whitespace-nowrap">
                      <Tag>{p.segment}</Tag>
                    </Td>
                    <Td className="max-w-[220px] truncate text-muted-foreground">{p.trigger}</Td>
                    <Td className="max-w-[200px]">
                      {p.evidence[0] ? (
                        <EvidenceChip label={p.evidence[0].source} title={p.evidence[0].claim} />
                      ) : (
                        <MachineLabel>NONE</MachineLabel>
                      )}
                    </Td>
                    <Td>
                      <Tag tone={p.stage === "rejected" ? "danger" : p.stage === "won" ? "signal" : "neutral"}>
                        {p.stage}
                      </Tag>
                    </Td>
                    <Td align="right" mono className="text-muted-foreground">
                      {relative(p.lastTouch)}
                    </Td>
                    <Td className="max-w-[220px] truncate text-muted-foreground">{p.nextAction}</Td>
                  </Tr>
                ))}
              </tbody>
            </LedgerTable>
          </Panel>
        </>
      )}

      <InspectorPanel
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? `${selected.person} · ${selected.company}` : ""}
        meta={
          selected && (
            <MachineLabel>
              {selected.role} · {selected.segment} · SCORE {selected.score} · {selected.status}
            </MachineLabel>
          )
        }
        footer={selected ? <ProspectActions prospect={selected} /> : null}
      >
        {selected && (
          <div className="space-y-5">
            <Section title="WHY NOW">
              <p className="text-[14px]">{selected.trigger}</p>
            </Section>

            <Section title="WHY FIT">
              <div className="flex flex-wrap gap-1.5">
                {selected.fitFactors.map((f) => (
                  <Tag key={f} tone="signal">
                    {f}
                  </Tag>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {selected.scoreFactors.map((f) => (
                  <div key={f.label} title={f.note}>
                    <div className="flex items-center justify-between">
                      <span className="machine">{f.label}</span>
                      <span className="numeral text-[12px]">+{f.weight}</span>
                    </div>
                    <div className="mt-1">
                      <Meter value={f.weight / 40} />
                    </div>
                    <p className="machine mt-1 normal-case tracking-normal">{f.note}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="EVIDENCE">
              <ul className="space-y-2">
                {selected.evidence.map((e) => (
                  <li key={e.claim} className="border-l-2 border-border pl-3">
                    <p className="text-[13px]">{e.claim}</p>
                    <MachineLabel>
                      {e.source} · {stamp(e.observedAt)}
                    </MachineLabel>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="CONVERSATION">
              {thread ? (
                <ul className="space-y-3">
                  {thread.messages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "pl-3 text-[13px] leading-relaxed",
                        m.author === "AGENT" ? "border-l-2 border-signal bg-surface-2 py-2 pr-2" : "border-l-2 border-border",
                      )}
                    >
                      <MachineLabel tone={m.author === "AGENT" ? "signal" : "muted"}>
                        {m.author === "AGENT" ? "AGENT DRAFT" : m.author} · {stamp(m.sentAt)}
                      </MachineLabel>
                      <p className="mt-1">{m.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <MachineLabel>NO CONVERSATION YET</MachineLabel>
              )}
            </Section>

            <Section title="NEXT ACTION">
              <p className="text-[14px]">{selected.nextAction}</p>
              {selected.opportunityValue !== null && (
                <p className="machine mt-1">ESTIMATED OPPORTUNITY {gbp(selected.opportunityValue)}</p>
              )}
            </Section>
          </div>
        )}
      </InspectorPanel>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <MachineLabel tone="signal">{title}</MachineLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}
