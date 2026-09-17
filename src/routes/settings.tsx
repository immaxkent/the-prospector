import { createFileRoute } from "@tanstack/react-router";
import { useDataset, setDataMode, useDataMode } from "@/data/store";
import { Button, MachineLabel, PageHeader, Panel, StatusDot, Tag } from "@/components/os/primitives";
import { stamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CBO OS" },
      {
        name: "description",
        content: "Model provider, local database status, email connector, autonomy, send caps, research sources and export.",
      },
      { property: "og:title", content: "Settings — CBO OS" },
      { property: "og:description", content: "Local configuration for the commercial agent." },
    ],
  }),
  component: SettingsScreen,
});

function SettingsScreen() {
  const { status, interfaces } = useDataset();
  const mode = useDataMode();

  const inputCls =
    "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

  return (
    <div className="space-y-5">
      <PageHeader title="SETTINGS" summary="Local single-operator configuration. No authentication in v1." />

      <Panel title="DATA MODE" bodyClassName="px-4 py-4">
        <p className="text-[13px] text-muted-foreground">
          Design fixtures live in one file and can be switched off to see the clean, zero-record application.
        </p>
        <div className="mt-3 flex gap-1">
          {(["fixtures", "empty"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setDataMode(m)}
              className={cn(
                "machine rounded-[3px] border px-3 py-2",
                mode === m ? "border-signal bg-signal-soft text-primary" : "border-border hover:bg-accent",
              )}
            >
              {m === "fixtures" ? "DESIGN FIXTURES" : "CLEAN / EMPTY"}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="MODEL / PROVIDER" bodyClassName="space-y-3 px-4 py-4">
          <Row label="PROVIDER">
            <input className={inputCls} defaultValue={status.provider} />
          </Row>
          <Row label="MODEL">
            <input className={inputCls} defaultValue={status.model} />
          </Row>
          <Row label="DEFAULT AUTONOMY">
            <select className={inputCls} defaultValue={status.autonomy}>
              <option value="MANUAL">MANUAL</option>
              <option value="SUGGEST">SUGGEST</option>
              <option value="SEMI_AUTO">SEMI_AUTO</option>
              <option value="AUTO">AUTO</option>
            </select>
          </Row>
        </Panel>

        <Panel title="DATABASE / LOCAL STORAGE" bodyClassName="divide-y divide-border">
          <Line label="STORAGE" value={`${status.db} — on-disk, single operator`} ok />
          <Line label="LAST RUN" value={status.lastRunAt ? stamp(status.lastRunAt) : "NEVER"} ok={!!status.lastRunAt} />
          <Line label="SCHEMA" value="v1" ok />
        </Panel>

        <Panel title="EMAIL CONNECTOR" bodyClassName="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px]">Outbound email account</span>
            <Tag tone={status.emailConnected ? "signal" : "neutral"}>
              {status.emailConnected ? "CONNECTED" : "NOT CONNECTED"}
            </Tag>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Until an account is connected, approved messages are exported rather than sent.
          </p>
          <div className="mt-3">
            <Button variant="primary" size="sm">
              Connect email
            </Button>
          </div>
        </Panel>

        <Panel title="SEND CAPS / QUIET HOURS" bodyClassName="space-y-3 px-4 py-4">
          <Row label="DAILY SEND CAP">
            <input className={`${inputCls} numeral`} defaultValue={status.sendCapPerDay} />
          </Row>
          <Row label="QUIET HOURS">
            <input className={inputCls} defaultValue={status.quietHours} />
          </Row>
        </Panel>

        <Panel title="RESEARCH SOURCES" bodyClassName="px-4 py-4">
          <ul className="space-y-2">
            {status.researchSources.map((s) => (
              <li key={s} className="flex items-center justify-between">
                <span className="text-[13px]">{s}</span>
                <MachineLabel tone="signal">ENABLED</MachineLabel>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="IMPORT / EXPORT" bodyClassName="flex flex-wrap gap-2 px-4 py-4">
          <Button size="sm">Export JSON</Button>
          <Button size="sm">Export CSV</Button>
          <Button size="sm">Import records</Button>
        </Panel>

        <Panel title="INTERFACE / API STATUS" bodyClassName="divide-y divide-border xl:col-span-2">
          {interfaces.map((i) => (
            <Line key={i.id} label={i.name} value={i.endpoint} ok={i.status !== "NOT_CONNECTED"} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <MachineLabel>{label}</MachineLabel>
      {children}
    </label>
  );
}

function Line({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="flex items-center gap-2 text-[13px]">
        <StatusDot tone={ok ? "ok" : "idle"} />
        {label}
      </span>
      <span className="numeral truncate text-[12px] text-muted-foreground">{value}</span>
    </div>
  );
}
