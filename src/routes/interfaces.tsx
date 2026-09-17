import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import {
  InspectorPanel,
  MachineLabel,
  MetricCell,
  PageHeader,
  Panel,
  StatusDot,
  Tag,
} from "@/components/os/primitives";
import { stamp } from "@/lib/format";
import type { SystemInterface } from "@/data/types";

export const Route = createFileRoute("/interfaces")({
  head: () => ({
    meta: [
      { title: "Interfaces — CBO OS" },
      {
        name: "description",
        content: "Interface-ready systems panel: email, AWEEDINARY, Good Paper OS, generic events and JSON/CSV export.",
      },
      { property: "og:title", content: "Interfaces — CBO OS" },
      { property: "og:description", content: "Declared endpoints, event schema and recent event log — no fake integrations." },
    ],
  }),
  component: InterfacesScreen,
});

const tone = {
  NOT_CONNECTED: "idle",
  INTERFACE_READY: "ok",
  ACTIVE: "ok",
  READY: "ok",
} as const;

function InterfacesScreen() {
  const { interfaces } = useDataset();
  const [open, setOpen] = useState<SystemInterface | null>(null);

  const inbound = interfaces.reduce((t, i) => t + i.inbound, 0);
  const outbound = interfaces.reduce((t, i) => t + i.outbound, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="INTERFACES"
        summary="CBO OS runs locally and exposes a stable event surface so external systems can be attached later."
      />

      <Panel bodyClassName="grid grid-cols-3 gap-6 px-4 py-4">
        <MetricCell label="INBOUND EVENTS" value={inbound} />
        <MetricCell label="OUTBOUND EVENTS" value={outbound} />
        <MetricCell label="SCHEMA" value="v1" />
      </Panel>

      <Panel title="SYSTEMS">
        <ul className="hairline-y">
          {interfaces.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => setOpen(i)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-accent"
              >
                <span className="flex items-center gap-3">
                  <StatusDot tone={tone[i.status]} live={i.status === "ACTIVE"} />
                  <span className="text-[14px]">{i.name}</span>
                </span>
                <span className="flex items-center gap-4">
                  <MachineLabel>
                    IN {i.inbound} · OUT {i.outbound}
                  </MachineLabel>
                  <Tag tone={i.status === "NOT_CONNECTED" ? "neutral" : "signal"}>{i.status.replace("_", " ")}</Tag>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <InspectorPanel
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        meta={open && <MachineLabel>{open.status.replace("_", " ")} · SCHEMA {open.schema}</MachineLabel>}
      >
        {open && (
          <div className="space-y-5">
            <div>
              <MachineLabel tone="signal">ENDPOINT</MachineLabel>
              <p className="numeral mt-1 break-all text-[13px]">{open.endpoint}</p>
            </div>
            <div>
              <MachineLabel tone="signal">EVENT TYPES</MachineLabel>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {open.eventTypes.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
            <div>
              <MachineLabel tone="signal">LAST EVENT</MachineLabel>
              <p className="numeral mt-1 text-[13px]">{open.lastEventAt ? stamp(open.lastEventAt) : "NONE"}</p>
            </div>
            <div>
              <MachineLabel tone="signal">RECENT EVENT LOG</MachineLabel>
              {open.events.length === 0 ? (
                <p className="machine mt-1.5">NO EVENTS RECORDED</p>
              ) : (
                <ul className="mt-1.5 hairline-y rounded-[3px] border border-border">
                  {open.events.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 px-3 py-2">
                      <span className="numeral text-[11px] text-muted-foreground">{stamp(e.at)}</span>
                      <span className="machine w-[32px]">{e.direction}</span>
                      <span className="numeral flex-1 text-[12px]">
                        {e.type} — {e.payloadSummary}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </InspectorPanel>
    </div>
  );
}
