import type { Approval } from "@/data/types";
import { gbp, stamp } from "@/lib/format";
import { Button, EvidenceChip, MachineLabel, Tag } from "./primitives";

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

      <div className="mt-2.5 border-l-2 border-signal bg-surface-2 px-3 py-2">
        <MachineLabel tone="signal">AGENT DRAFT</MachineLabel>
        <p className="mt-1 text-[13px] leading-relaxed">{approval.copy}</p>
      </div>

      {approval.evidence.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {approval.evidence.map((e) => (
            <EvidenceChip key={e.claim} label={e.claim} title={`${e.source} · ${stamp(e.observedAt)}`} />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => onResolve?.(approval.id, "APPROVE")}>
          Approve
        </Button>
        <Button size="sm" onClick={() => onResolve?.(approval.id, "EDIT")}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onResolve?.(approval.id, "REJECT")}>
          Reject
        </Button>
      </div>
    </article>
  );
}
