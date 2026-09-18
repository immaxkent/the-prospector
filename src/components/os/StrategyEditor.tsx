import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchEndeavourSpecFn, reviseEndeavourSpecFn } from "@/api/spec";
import { errorMessage } from "@/data/mutations";
import { datasetQuery } from "@/data/queries";
import { useAppMode } from "@/data/store";
import { IntakeFieldRow, summarise, type IntakeFieldState } from "./IntakeFieldRow";
import { Button, MachineLabel, Tag } from "./primitives";

const FIELD_ORDER = [
  "objective",
  "horizon",
  "offering",
  "pricing",
  "proof",
  "buyers",
  "exclusions",
  "cadence",
] as const;
const FIELD_LABELS: Record<string, string> = {
  objective: "Objective",
  horizon: "Horizon",
  offering: "What you sell",
  pricing: "Pricing",
  proof: "Proof",
  buyers: "Who buys it",
  exclusions: "Who you will not work with",
  cadence: "Daily cadence",
};

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

type Spec = Record<string, unknown>;

/**
 * Editing a running endeavour's strategy. Changes are staged locally and saved together as one
 * revision with a reason, so the history reads as decisions rather than keystrokes.
 */
export function StrategyEditor({ endeavourId }: { endeavourId: string }) {
  const mode = useAppMode();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Spec | null>(null);
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["endeavour-spec", endeavourId] as const,
    queryFn: () => fetchEndeavourSpecFn({ data: { endeavourId } }),
    enabled: mode === "live",
  });

  const revise = useMutation({
    mutationFn: (data: { endeavourId: string; spec: Spec; reason: string }) =>
      reviseEndeavourSpecFn({ data }),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["endeavour-spec", endeavourId] }),
        client.invalidateQueries({ queryKey: datasetQuery.queryKey }),
      ]);
      setDraft(null);
      setReason("");
      toast.success(`Saved as version ${result.version}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (mode === "demo") {
    return (
      <p className="px-4 py-6 text-[13px] text-muted-foreground">
        Demo mode has no database, so the strategy cannot be edited here.
      </p>
    );
  }
  if (query.isPending)
    return <MachineLabel className="block px-4 py-6">LOADING STRATEGY</MachineLabel>;
  if (query.isError)
    return <p className="px-4 py-6 text-[13px] text-warn">{errorMessage(query.error)}</p>;

  const saved = query.data.spec as unknown as Spec;
  const spec = draft ?? saved;
  const edited = FIELD_ORDER.filter(
    (field) => JSON.stringify(spec[field]) !== JSON.stringify(saved[field]),
  );
  const archived = query.data.status === "archived";

  const update = (field: string, state: IntakeFieldState) => setDraft({ ...spec, [field]: state });

  return (
    <div className="divide-y divide-border" data-testid="strategy-editor">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <MachineLabel>VERSION {query.data.version} · EDITS ARE SAVED AS A NEW VERSION</MachineLabel>
        <Tag tone={edited.length ? "warn" : "neutral"}>
          {edited.length ? `${edited.length} UNSAVED` : "NO CHANGES"}
        </Tag>
      </div>

      {FIELD_ORDER.map((field) => (
        <IntakeFieldRow
          key={field}
          field={field}
          label={FIELD_LABELS[field] ?? field}
          state={spec[field] as IntakeFieldState}
          question={undefined}
          answer=""
          busy={revise.isPending || archived}
          onAnswerChange={() => {}}
          onConfirm={() => {
            const current = spec[field] as IntakeFieldState;
            if ("value" in current) update(field, { state: "confirmed", value: current.value });
          }}
          onNotApplicable={(why) => update(field, { state: "not_applicable", reason: why })}
          onSet={(value) => update(field, { state: "confirmed", value })}
        />
      ))}

      <div className="space-y-3 px-4 py-3">
        {edited.length > 0 && (
          <div className="space-y-1.5">
            <MachineLabel tone="signal">
              CHANGING: {edited.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
            </MachineLabel>
            <input
              aria-label="Reason for the revision"
              className={inputCls}
              placeholder="Why is the strategy changing?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={revise.isPending || archived || edited.length === 0 || !reason.trim()}
            onClick={() => revise.mutate({ endeavourId, spec, reason })}
          >
            {revise.isPending ? "Saving…" : "Save revision"}
          </Button>
          {edited.length > 0 && (
            <Button size="sm" disabled={revise.isPending} onClick={() => setDraft(null)}>
              Discard changes
            </Button>
          )}
          {archived && (
            <MachineLabel className="self-center">
              ARCHIVED: THE STRATEGY CANNOT CHANGE
            </MachineLabel>
          )}
        </div>
      </div>

      {query.data.history.length > 0 && (
        <div className="px-4 py-3">
          <MachineLabel>HISTORY</MachineLabel>
          <ul className="mt-2 space-y-1.5" data-testid="strategy-history">
            {[...query.data.history].reverse().map((entry) => (
              <li key={entry.version} className="text-[13px]">
                <span className="machine">V{entry.version}</span> {entry.reason}
                <span className="machine ml-2">{entry.createdAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 py-3">
        <MachineLabel>BRIEF THIS ENDEAVOUR STARTED FROM</MachineLabel>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-muted-foreground">
          {query.data.brief}
        </p>
        <MachineLabel className="mt-2 block">
          CURRENT OFFER:{" "}
          {summarise((spec["offering"] as { value?: unknown } | undefined)?.value) || "not set"}
        </MachineLabel>
      </div>
    </div>
  );
}
