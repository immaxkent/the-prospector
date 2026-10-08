import type { Approval } from "@/data/types";
import { gbp, stamp } from "@/lib/format";
import { ApprovalActions } from "./ApprovalActions";
import { MachineLabel, Tag } from "./primitives";

const kindTone = {
  OUTREACH_DRAFT: "signal",
  THREAD_MAPPING: "warn",
  REPLY_APPROVAL: "signal",
  HOT_LEAD: "signal",
  PRICING_DECISION: "warn",
  FAILED_RUN: "danger",
} as const;

/** Source: approval queue (Approval records). */
export function ApprovalTicket({
  approval,
  endeavourName,
  onResolve,
}: {
  approval: Approval;
  endeavourName?: string | undefined | undefined;
  onResolve?: (id: string, action: "APPROVE" | "EDIT" | "REJECT") => void | undefined;
}) {
  return (
    <article className="border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tag tone={kindTone[approval.kind]}>{approval.kind.replace("_", " ")}</Tag>
            {endeavourName && <MachineLabel>{endeavourName}</MachineLabel>}
          </div>
          <h3 className="mt-1.5 truncate text-[14px] font-medium">{approval.title}</h3>
          <div className="machine mt-1">TO: {approval.recipient}</div>
        </div>
        <div className="shrink-0 text-right">
          <MachineLabel>{approval.value !== null ? "OPPORTUNITY" : "CREATED"}</MachineLabel>
          <div className="numeral text-[15px]">
            {approval.value !== null ? gbp(approval.value) : stamp(approval.createdAt).slice(11)}
          </div>
        </div>
      </div>

      <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{approval.why}</p>

      {/*
       * The draft and what it was written from, side by side.
       *
       * The claims were chips with the source in a tooltip, which meant the one question an
       * approver has — is this true, and does the draft say what the evidence supports —
       * took a hover per claim and a comparison held in the head. A draft citing nothing is
       * called out rather than merely showing an empty row: the agent is told to write from
       * evidence, so no evidence is a reason to read it harder, not a tidy absence.
       */}
      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="border-l-2 border-signal bg-surface-2 px-3 py-2" data-testid="draft-copy">
          <MachineLabel tone="signal">AGENT DRAFT</MachineLabel>
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{approval.copy}</p>
        </div>

        <div className="border-l-2 border-border px-3 py-2" data-testid="draft-evidence">
          <MachineLabel>WRITTEN FROM</MachineLabel>
          {approval.evidence.length === 0 ? (
            <p className="mt-1 text-[12px] text-warn" data-testid="draft-no-evidence">
              Nothing cited. Read this one closely before it goes.
            </p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {approval.evidence.map((e) => (
                <li key={e.id} className="text-[12px] leading-relaxed">
                  <p>{e.claim}</p>
                  <MachineLabel>
                    {e.source} · {stamp(e.observedAt)}
                  </MachineLabel>
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer"
                      className="machine ml-1 text-muted-foreground underline hover:text-foreground"
                    >
                      SOURCE
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3">
        <ApprovalActions
          approval={approval}
          onDemoResolve={onResolve ? (id) => onResolve(id, "APPROVE") : undefined}
        />
      </div>
    </article>
  );
}
