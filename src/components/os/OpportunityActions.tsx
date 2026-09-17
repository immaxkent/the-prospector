import { useState } from "react";
import { toast } from "sonner";
import type { Opportunity } from "@/data/types";
import { useAppMode } from "@/data/store";
import { useUpdateOpportunity } from "@/data/mutations";
import { Button } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1 text-[12px] outline-none focus:border-signal";

/** Row controls for an opportunity: correct value and probability, or close it as won or lost with a reason. */
export function OpportunityActions({ opportunity }: { opportunity: Opportunity }) {
  const mode = useAppMode();
  const update = useUpdateOpportunity();
  const [panel, setPanel] = useState<"none" | "edit" | "won" | "lost">("none");
  const [value, setValue] = useState(String(opportunity.value));
  const [probability, setProbability] = useState(String(Math.round(opportunity.probability * 100)));
  const [reason, setReason] = useState("");
  const busy = update.isPending;
  const closed = opportunity.stage === "won" || opportunity.stage === "lost";

  const submit = (data: Parameters<typeof update.mutate>[0]) => {
    if (mode === "demo") {
      toast("Demo mode: nothing was saved");
      return;
    }
    update.mutate(data, { onSuccess: () => setPanel("none") });
  };

  if (panel === "edit") {
    const v = Number(value);
    const p = Number(probability);
    const valid = Number.isInteger(v) && v >= 0 && Number.isFinite(p) && p >= 0 && p <= 100;
    return (
      <div className="flex min-w-[260px] items-center gap-1.5" data-testid="opportunity-actions">
        <input
          aria-label="Value"
          className={`${inputCls} numeral`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <input
          aria-label="Probability %"
          className={`${inputCls} numeral w-[64px]`}
          value={probability}
          onChange={(e) => setProbability(e.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !valid}
          onClick={() => submit({ opportunityId: opportunity.id, value: v, probability: p / 100 })}
        >
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPanel("none")}>
          ×
        </Button>
      </div>
    );
  }

  if (panel === "won" || panel === "lost") {
    return (
      <div className="flex min-w-[260px] items-center gap-1.5" data-testid="opportunity-actions">
        <input
          aria-label={panel === "won" ? "Why it was won" : "Why it was lost"}
          className={inputCls}
          placeholder={panel === "won" ? "Why it was won" : "Why it was lost"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          variant={panel === "won" ? "primary" : "destructive"}
          size="sm"
          disabled={busy || !reason.trim()}
          onClick={() =>
            submit({
              opportunityId: opportunity.id,
              outcome: { stage: panel, reason: reason.trim() },
            })
          }
        >
          Confirm {panel}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPanel("none")}>
          ×
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-1" data-testid="opportunity-actions">
      <Button size="sm" disabled={busy} onClick={() => setPanel("edit")}>
        Edit
      </Button>
      {!closed && (
        <>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => setPanel("won")}>
            Won
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPanel("lost")}>
            Lost
          </Button>
        </>
      )}
    </div>
  );
}
