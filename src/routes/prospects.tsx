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
import { gbp, relative, scoreText, stamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProspectActions } from "@/components/os/ProspectActions";
import { countDecisions, orderByDecision, type ProspectState } from "@/data/prospect-state";
import { BulkDecide } from "@/components/os/BulkDecide";
import { ReachTag } from "@/components/os/ReachTag";
import { LogInteraction } from "@/components/os/LogInteraction";

export const Route = createFileRoute("/prospects")({
  head: () => ({
    meta: [
      { title: "Prospects — CBO OS" },
      {
        name: "description",
        content:
          "Research blotter of scored prospects with trigger, evidence, stage, last touch and next action.",
      },
      { property: "og:title", content: "Prospects — CBO OS" },
      {
        property: "og:description",
        content: "A research terminal crossed with a financial blotter.",
      },
    ],
  }),
  component: ProspectsScreen,
});

/**
 * The list is filtered by what a prospect needs, not by what stage it reached.
 *
 * Stage is a fact about the pipeline; state is a question about the operator. A person
 * clearing a day's prospects wants the second, so NEEDS YOU is where the page opens.
 */
const STATE_FILTERS: { key: string; label: string; states: readonly ProspectState[] }[] = [
  { key: "needs", label: "NEEDS YOU", states: ["undecided"] },
  { key: "coming", label: "NOT JUDGED", states: ["unjudged"] },
  { key: "released", label: "RELEASED", states: ["accepted"] },
  { key: "rejected", label: "REJECTED", states: ["declined"] },
  { key: "ALL", label: "ALL", states: ["undecided", "unjudged", "accepted", "declined"] },
];

function ProspectsScreen() {
  const { prospects, endeavours, threads, isEmpty } = useDataset();
  const [filter, setFilter] = useState("needs");
  const [endeavour, setEndeavour] = useState("ALL");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Derived from the dataset so the inspector reflects changes after an action.
  const selected = prospects.find((p) => p.id === selectedId) ?? null;

  const inScope = useMemo(
    () =>
      prospects.filter(
        (p) =>
          (endeavour === "ALL" || p.endeavourId === endeavour) &&
          (q === "" ||
            `${p.person} ${p.company} ${p.segment} ${p.trigger}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [prospects, endeavour, q],
  );
  // Counted before the state filter, so the tabs say what is behind them rather than what is shown.
  const counts = useMemo(() => countDecisions(inScope), [inScope]);
  const rows = useMemo(() => {
    const wanted = STATE_FILTERS.find((f) => f.key === filter)?.states ?? [];
    return orderByDecision(inScope).filter((p) => wanted.includes(p.decision.state));
  }, [inScope, filter]);

  // Off the whole list, not off the visible rows: a tick must survive changing filter,
  // or a selection quietly shrinks while the operator is still making it.
  const tickedProspects = useMemo(
    () => prospects.filter((p) => ticked.has(p.id)),
    [prospects, ticked],
  );
  const allShown = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const toggle = (id: string) =>
    setTicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const thread = selected ? threads.find((t) => t.prospectId === selected.id) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="PROSPECTS"
        summary={`${counts.needsDecision} waiting on you · ${counts.unjudged} not judged yet · ${counts.accepted} released · ${counts.declined} rejected`}
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
              {STATE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "machine rounded-[3px] border px-2 py-1.5",
                    filter === f.key
                      ? "border-signal bg-signal-soft text-primary"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {f.label} {countFor(f.key, counts)}
                </button>
              ))}
            </div>
          </div>

          {tickedProspects.length > 0 && (
            <BulkDecide selected={tickedProspects} onDone={() => setTicked(new Set())} />
          )}

          {rows.length === 0 ? (
            <Panel>
              <p className="text-[14px]" data-testid="bucket-empty">
                Nothing here.{" "}
                {filter === "needs"
                  ? "Every prospect that has been judged has had its decision."
                  : "Try another filter."}
              </p>
              <p className="machine mt-2">
                {counts.needsDecision} WAITING · {counts.unjudged} NOT JUDGED · {counts.accepted}{" "}
                RELEASED · {counts.declined} REJECTED
              </p>
            </Panel>
          ) : (
            <Panel bodyClassName="max-h-[70vh] overflow-auto">
              <LedgerTable>
                <thead>
                  <tr>
                    <Th>
                      <input
                        aria-label={allShown ? "Clear all shown" : "Select all shown"}
                        type="checkbox"
                        checked={allShown}
                        onChange={() =>
                          setTicked((was) => {
                            const next = new Set(was);
                            for (const r of rows) {
                              if (allShown) next.delete(r.id);
                              else next.add(r.id);
                            }
                            return next;
                          })
                        }
                      />
                    </Th>
                    <Th align="right">Score</Th>
                    <Th>Person</Th>
                    <Th>Company</Th>
                    <Th>Why it is here</Th>
                    <Th>Segment</Th>
                    <Th>Trigger</Th>
                    <Th>Evidence</Th>
                    <Th>Stage</Th>
                    <Th align="right">Last touch</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <Tr
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      active={selected?.id === p.id}
                    >
                      <Td className="w-[32px]">
                        <input
                          aria-label={`Select ${p.company}`}
                          type="checkbox"
                          checked={ticked.has(p.id)}
                          onChange={() => toggle(p.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Td>
                      <Td align="right" mono className="w-[70px]">
                        <span
                          className={cn(
                            p.score === null
                              ? "text-muted-foreground"
                              : p.score >= 80
                                ? "text-signal"
                                : p.score < 55
                                  ? "text-muted-foreground"
                                  : undefined,
                          )}
                        >
                          {scoreText(p.score)}
                        </span>
                      </Td>
                      <Td className="whitespace-nowrap font-medium">{p.person}</Td>
                      <Td className="whitespace-nowrap">{p.company}</Td>
                      <Td
                        className={cn(
                          "max-w-[230px] truncate",
                          p.decision.needsDecision ? "text-foreground" : "text-muted-foreground",
                        )}
                        title={p.decision.reason}
                      >
                        {p.decision.reason}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <ReachTag contacts={p.contacts} />
                      </Td>
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
                        <Tag
                          tone={
                            p.stage === "rejected"
                              ? "danger"
                              : p.stage === "won"
                                ? "signal"
                                : "neutral"
                          }
                        >
                          {p.stage}
                        </Tag>
                      </Td>
                      <Td align="right" mono className="text-muted-foreground">
                        {relative(p.lastTouch)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </LedgerTable>
            </Panel>
          )}
        </>
      )}

      <InspectorPanel
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected ? `${selected.person} · ${selected.company}` : ""}
        meta={
          selected && (
            <div className="flex flex-wrap items-center gap-2">
              <MachineLabel>
                {selected.role} · {selected.segment} ·{" "}
                {selected.score === null ? "NOT SCORED YET" : `SCORE ${selected.score}`} ·{" "}
                {selected.status}
              </MachineLabel>
              <ReachTag contacts={selected.contacts} />
            </div>
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
                        m.author === "AGENT"
                          ? "border-l-2 border-signal bg-surface-2 py-2 pr-2"
                          : "border-l-2 border-border",
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

            <Section title="CONTACT ELSEWHERE">
              <LogInteraction prospectId={selected.id} />
            </Section>

            <Section title="NEXT ACTION">
              <p className="text-[14px]">{selected.nextAction}</p>
              {selected.opportunityValue !== null && (
                <p className="machine mt-1">
                  ESTIMATED OPPORTUNITY {gbp(selected.opportunityValue)}
                </p>
              )}
            </Section>
          </div>
        )}
      </InspectorPanel>
    </div>
  );
}

/** The number behind each tab. ALL is the sum, so the tabs always account for the whole list. */
function countFor(key: string, c: ReturnType<typeof countDecisions>): number {
  if (key === "needs") return c.needsDecision;
  if (key === "coming") return c.unjudged;
  if (key === "released") return c.accepted;
  if (key === "rejected") return c.declined;
  return c.needsDecision + c.unjudged + c.accepted + c.declined;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <MachineLabel tone="signal">{title}</MachineLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}
