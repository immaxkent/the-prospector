import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useDataset } from "@/data/store";
import { Button, EmptyState, MachineLabel, PageHeader, Panel, StatusDot, Tag } from "@/components/os/primitives";
import { gbp, relative, stamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — CBO OS" },
      {
        name: "description",
        content: "Conversations with detected intent, objections, opportunity value and the agent's suggested response.",
      },
      { property: "og:title", content: "Inbox — CBO OS" },
      { property: "og:description", content: "Thread list, conversation and an intelligence rail for every reply." },
    ],
  }),
  component: InboxScreen,
});

function InboxScreen() {
  const { threads, prospects, isEmpty } = useDataset();
  const [activeId, setActiveId] = useState<string | null>(threads[0]?.id ?? null);
  const thread = threads.find((t) => t.id === activeId) ?? threads[0];
  const prospect = thread ? prospects.find((p) => p.id === thread.prospectId) : undefined;

  if (isEmpty || !thread) {
    return (
      <div className="space-y-5">
        <PageHeader title="INBOX" />
        <EmptyState
          title="NO CONVERSATIONS"
          body="Threads appear here once outreach has been sent and a prospect replies."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="INBOX" summary={`${threads.length} threads · ${threads.filter((t) => t.unread).length} unread`} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Thread list */}
        <Panel title="THREADS" bodyClassName="max-h-[70vh] overflow-y-auto">
          <ul className="hairline-y">
            {threads.map((t) => {
              const p = prospects.find((x) => x.id === t.prospectId);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "w-full px-3 py-2.5 text-left hover:bg-accent",
                      t.id === thread.id && "bg-signal-soft",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{p?.company ?? "Unknown"}</span>
                      {t.unread && <StatusDot tone="ok" live />}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">{t.subject}</div>
                    <MachineLabel>
                      {t.channel} · {relative(t.lastActivityAt)}
                    </MachineLabel>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        {/* Conversation */}
        <Panel
          title={thread.subject}
          meta={<MachineLabel>{prospect ? `${prospect.person} · ${prospect.company}` : ""}</MachineLabel>}
          bodyClassName="flex max-h-[70vh] flex-col"
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {thread.messages.map((m) => (
              <article
                key={m.id}
                className={cn(
                  "text-[14px] leading-relaxed",
                  m.author === "AGENT"
                    ? "border-l-2 border-signal bg-surface-2 px-3 py-2.5"
                    : m.author === "PROSPECT"
                      ? "border-l-2 border-border px-3 py-1"
                      : "border-l-2 border-foreground/20 px-3 py-1",
                )}
              >
                <div className="flex items-center gap-2">
                  <MachineLabel tone={m.author === "AGENT" ? "signal" : "muted"}>
                    {m.author === "AGENT" ? (m.draft ? "AGENT DRAFT" : "AGENT SENT") : m.author}
                  </MachineLabel>
                  <MachineLabel>{stamp(m.sentAt)}</MachineLabel>
                </div>
                <p className="mt-1.5">{m.body}</p>
                {m.draft && (
                  <div className="mt-2.5 flex gap-2">
                    <Button variant="primary" size="sm">
                      Approve &amp; send
                    </Button>
                    <Button size="sm">Edit</Button>
                    <Button variant="ghost" size="sm">
                      Reject
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </Panel>

        {/* Intelligence rail */}
        <Panel title="INTELLIGENCE" bodyClassName="divide-y divide-border">
          <Rail label="STAGE">
            <Tag tone="signal">{prospect?.stage ?? "—"}</Tag>
          </Rail>
          <Rail label="OPPORTUNITY VALUE">
            <span className="numeral text-[15px]">
              {prospect?.opportunityValue != null ? gbp(prospect.opportunityValue) : "—"}
            </span>
          </Rail>
          <Rail label="DETECTED INTENT">
            <p className="text-[13px]">{thread.intent}</p>
          </Rail>
          <Rail label="OBJECTIONS">
            {thread.objections.length ? (
              <ul className="space-y-1">
                {thread.objections.map((o) => (
                  <li key={o} className="text-[13px] text-warn">
                    {o}
                  </li>
                ))}
              </ul>
            ) : (
              <MachineLabel>NONE DETECTED</MachineLabel>
            )}
          </Rail>
          <Rail label="NEXT ACTION">
            <p className="text-[13px]">{prospect?.nextAction ?? "—"}</p>
          </Rail>
          <Rail label="SUGGESTED RESPONSE">
            <p className="border-l-2 border-signal bg-surface-2 px-2.5 py-2 text-[13px]">{thread.suggestedResponse}</p>
          </Rail>
        </Panel>
      </div>
    </div>
  );
}

function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <MachineLabel>{label}</MachineLabel>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
