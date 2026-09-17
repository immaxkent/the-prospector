import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
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
import { gbp, num, shortDate, stamp, daysUntil } from "@/lib/format";

export const Route = createFileRoute("/endeavours/")({
  head: () => ({
    meta: [
      { title: "Endeavours — CBO OS" },
      {
        name: "description",
        content: "Ledger of commercial endeavours: objective, horizon, progress, pipeline, quota and agent run state.",
      },
      { property: "og:title", content: "Endeavours — CBO OS" },
      { property: "og:description", content: "Every commercial objective tracked as a disciplined ledger row." },
    ],
  }),
  component: EndeavoursScreen,
});

function EndeavoursScreen() {
  const { endeavours, isEmpty } = useDataset();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="ENDEAVOURS"
        summary="Each row is a measurable commercial outcome with its own research queue, cadence and execution loop."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New endeavour
          </Button>
        }
      />

      {isEmpty ? (
        <EmptyState
          title="NO ACTIVE ENDEAVOURS"
          body="Define a commercial outcome. CBO OS will build the target model, research queue, outreach cadence and daily execution loop around it."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create first endeavour
            </Button>
          }
        />
      ) : (
        <Panel>
          <LedgerTable>
            <thead>
              <tr>
                <Th>Endeavour</Th>
                <Th>Objective</Th>
                <Th align="right">Horizon</Th>
                <Th align="right">Progress</Th>
                <Th align="right">Pipeline</Th>
                <Th align="right">Quota</Th>
                <Th>Health</Th>
                <Th align="right">Last run</Th>
              </tr>
            </thead>
            <tbody>
              {endeavours.map((e) => {
                const quotaDone = e.quotaDone.outreach + e.quotaDone.followups + e.quotaDone.newProspects;
                const quotaTotal = e.quota.outreach + e.quota.followups + e.quota.newProspects;
                return (
                  <Tr key={e.id}>
                    <Td>
                      <Link to="/endeavours/$id" params={{ id: e.id }} className="hover:text-signal">
                        <span className="text-[13px] font-medium">{e.name}</span>
                      </Link>
                    </Td>
                    <Td className="max-w-[280px]">
                      <span className="text-[13px] text-muted-foreground">{e.objective}</span>
                    </Td>
                    <Td align="right" mono>
                      {daysUntil(e.deadline)}d
                      <div className="machine">{shortDate(e.deadline)}</div>
                    </Td>
                    <Td align="right" className="min-w-[160px]">
                      <div className="numeral text-[13px]">
                        {e.unit === "GBP" ? gbp(e.actualValue) : num(e.actualValue)}
                        <span className="text-muted-foreground">
                          {" / "}
                          {e.unit === "GBP" ? gbp(e.targetValue) : num(e.targetValue)}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Meter
                          value={e.actualValue / e.targetValue}
                          tone={e.health === "BEHIND" ? "danger" : e.health === "AT_RISK" ? "warn" : "signal"}
                        />
                      </div>
                    </Td>
                    <Td align="right" mono>
                      {e.unit === "GBP" ? gbp(e.pipelineValue) : num(e.pipelineValue)}
                    </Td>
                    <Td align="right" mono>
                      {quotaDone}/{quotaTotal}
                    </Td>
                    <Td>
                      <Tag tone={e.health === "ON_TRACK" ? "signal" : e.health === "AT_RISK" ? "warn" : "danger"}>
                        {e.health.replace("_", " ")}
                      </Tag>
                    </Td>
                    <Td align="right" mono className="text-muted-foreground">
                      {stamp(e.lastRunAt)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </LedgerTable>
        </Panel>
      )}

      <NewEndeavourSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <MachineLabel>{label}</MachineLabel>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

function NewEndeavourSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <InspectorPanel
      open={open}
      onClose={onClose}
      title="New endeavour"
      meta={<MachineLabel>DEFINE A MEASURABLE COMMERCIAL OUTCOME</MachineLabel>}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onClose}>
            Create endeavour
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="NAME">
          <input className={inputCls} placeholder="£3K Solidity Sprint" />
        </Field>
        <Field label="OBJECTIVE">
          <textarea className={inputCls} rows={2} placeholder="Generate £3,000 in consulting revenue" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="TARGET VALUE">
            <input className={`${inputCls} numeral`} placeholder="3000" />
          </Field>
          <Field label="UNIT">
            <select className={inputCls} defaultValue="GBP">
              <option value="GBP">GBP</option>
              <option value="COUNT">COUNT</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="DEADLINE">
            <input type="date" className={inputCls} />
          </Field>
          <Field label="HORIZON (DAYS)">
            <input className={`${inputCls} numeral`} placeholder="60" />
          </Field>
        </div>
        <Field label="TARGET AUDIENCE NOTES">
          <textarea className={inputCls} rows={2} placeholder="Who, and what makes them reachable right now" />
        </Field>
        <Field label="OFFER NOTES">
          <textarea className={inputCls} rows={2} placeholder="Scope, price, delivery window" />
        </Field>
        <Field label="CHANNELS">
          <div className="flex gap-2">
            {["EMAIL", "LINKEDIN", "TELEGRAM"].map((c) => (
              <label key={c} className="machine flex items-center gap-1.5 rounded-[3px] border border-border px-2 py-1.5">
                <input type="checkbox" defaultChecked={c === "EMAIL"} /> {c}
              </label>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="DAILY NEW OUTREACH">
            <input className={`${inputCls} numeral`} placeholder="10" />
          </Field>
          <Field label="DAILY FOLLOW-UPS">
            <input className={`${inputCls} numeral`} placeholder="8" />
          </Field>
        </div>
        <Field label="AUTONOMY LEVEL">
          <select className={inputCls} defaultValue="SEMI_AUTO">
            <option value="MANUAL">MANUAL — agent proposes nothing automatically</option>
            <option value="SUGGEST">SUGGEST — research and drafts, no sends</option>
            <option value="SEMI_AUTO">SEMI_AUTO — sends after approval</option>
            <option value="AUTO">AUTO — sends within caps</option>
          </select>
        </Field>
      </div>
    </InspectorPanel>
  );
}
