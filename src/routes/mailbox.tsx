import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAppMode, useDataset } from "@/data/store";
import {
  MAILBOX_VIEWS,
  filterThreads,
  mailboxCounts,
  openingFilter,
  type MailboxFilter,
} from "@/data/mailbox-filters";
import { useMarkThreadRead } from "@/data/mutations";
import { ApprovalActions } from "@/components/os/ApprovalActions";
import { EmptyState, MachineLabel, PageHeader, Panel, StatusDot, Tag } from "@/components/os/primitives";
import { gbp, relative, stamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/mailbox")({
  head: () => ({
    meta: [
      { title: "Mailbox — CBO OS" },
      {
        name: "description",
        content: "Conversations with detected intent, objections, opportunity value and the agent's suggested response.",
      },
      { property: "og:title", content: "Inbox — CBO OS" },
      { property: "og:description", content: "Thread list, conversation and an intelligence rail for every reply." },
    ],
  }),
  component: MailboxScreen,
});

function MailboxScreen() {
  const { threads: allThreads, prospects, approvals, isEmpty } = useDataset();
  const appMode = useAppMode();
  const markRead = useMarkThreadRead();
  const counts = mailboxCounts(allThreads);
  // The mailbox opens on whatever is waiting, and stays wherever the operator puts it.
  const [filter, setFilter] = useState<MailboxFilter | null>(null);
  const view = filter ?? openingFilter(allThreads);
  const threads = filterThreads(allThreads, view);

  const [activeId, setActiveId] = useState<string | null>(null);
  const thread = threads.find((t) => t.id === activeId) ?? threads[0];
  const prospect = thread ? prospects.find((p) => p.id === thread.prospectId) : undefined;

  const tabs = (
    <div className="flex flex-wrap gap-1" data-testid="mailbox-views">
      {MAILBOX_VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={v.id === view}
          onClick={() => {
            setFilter(v.id);
            // The thread that was open may not be in the new view; let it fall to the first.
            setActiveId(null);
          }}
          className={cn(
            "machine rounded-full border px-3 py-1.5 transition-colors",
            v.id === view
              ? "border-signal/50 bg-signal/5 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {v.label} <span className="tabular-nums opacity-60">{counts[v.id]}</span>
        </button>
      ))}
    </div>
  );

  if (isEmpty || !thread) {
    return (
      <div className="space-y-5">
        <PageHeader title="MAILBOX" summary="Drafts waiting on you, what has gone out, and what came back." />
        {!isEmpty && tabs}
        <EmptyState
          title="NOTHING HERE"
          body={
            isEmpty
              ? "Threads appear here once outreach has been sent and a prospect replies."
              : MAILBOX_VIEWS.find((v) => v.id === view)!.empty
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="MAILBOX"
        summary={`${counts.all} conversations · ${counts.drafts} waiting on you · ${allThreads.filter((t) => t.unread).length} unread`}
      />
      {tabs}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Thread list */}
        <Panel title="THREADS" bodyClassName="max-h-[70vh] overflow-y-auto">
          <ul className="hairline-y">
            {threads.map((t) => {
              const p = prospects.find((x) => x.id === t.prospectId);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => {
                      setActiveId(t.id);
                      if (appMode === "live" && t.unread) markRead.mutate({ threadId: t.id });
                    }}
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
                    {m.author === "AGENT"
                      ? m.draft
                        ? `AGENT DRAFT${m.sendState === "approved" ? " · APPROVED, WAITING TO SEND" : ""}`
                        : m.sendState === "sent"
                          ? "AGENT SENT"
                          : `AGENT ${(m.sendState ?? "sent").toUpperCase()}`
                      : m.author}
                  </MachineLabel>
                  <MachineLabel>{stamp(m.sentAt)}</MachineLabel>
                </div>
                <p className="mt-1.5">{m.body}</p>
                {(() => {
                  const draftApproval = approvals.find((a) => a.subjectType === "message" && a.subjectId === m.id);
                  return m.draft && draftApproval ? (
                    <div className="mt-2.5">
                      <ApprovalActions approval={draftApproval} />
                    </div>
                  ) : null;
                })()}
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
            <p className="border-l-2 border-signal bg-surface-2 px-2.5 py-2 text-[13px]">
              {thread.suggestedResponse || "No reply drafted"}
            </p>
            {(() => {
              const reply = approvals.find(
                (a) => a.kind === "REPLY_APPROVAL" && a.subjectType === "thread" && a.subjectId === thread.id,
              );
              return reply ? (
                <div className="mt-2" data-testid="reply-approval">
                  <ApprovalActions approval={reply} />
                </div>
              ) : null;
            })()}
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
