import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  activateIntakeFn,
  answerIntakeFn,
  editIntakeFieldFn,
  startIntakeFn,
  updateIntakeSettingsFn,
} from "@/api/intake";
import { IntakeFieldRow, type IntakeFieldState } from "@/components/os/IntakeFieldRow";
import { Button, MachineLabel, PageHeader, Panel, Tag } from "@/components/os/primitives";
import { errorMessage } from "@/data/mutations";
import { datasetQuery } from "@/data/queries";
import { useAppMode, useDataset } from "@/data/store";

export type IntakeView = Awaited<ReturnType<typeof startIntakeFn>>;

const FIELD_ORDER = ["objective", "horizon", "offering", "pricing", "proof", "buyers", "exclusions", "cadence"] as const;
const FIELD_LABELS: Record<string, string> = {
  objective: "Objective",
  horizon: "Horizon",
  offering: "What you sell",
  pricing: "Pricing",
  proof: "Proof",
  buyers: "Who buys it",
  exclusions: "Who you will not work with",
  cadence: "Daily cadence",
  mailboxId: "Sending mailbox",
};

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

export const Route = createFileRoute("/endeavours/new")({
  head: () => ({
    meta: [
      { title: "New endeavour — CBO OS" },
      { name: "description", content: "Describe a commercial outcome; the planner drafts the endeavour for your approval." },
    ],
  }),
  component: NewEndeavourScreen,
});

function NewEndeavourScreen() {
  const appMode = useAppMode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mailboxes } = useDataset();
  const [brief, setBrief] = useState("");
  const [view, setView] = useState<IntakeView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const apply = (next: IntakeView) => {
    setView(next);
    setAnswers({});
  };

  const start = useMutation({ mutationFn: (data: { brief: string }) => startIntakeFn({ data }), onSuccess: apply, onError });
  const answer = useMutation({
    mutationFn: (data: { intakeId: string; answers: { field: string; answer: string }[] }) =>
      answerIntakeFn({ data: data as never }),
    onSuccess: apply,
    onError,
  });
  const edit = useMutation({
    mutationFn: (data: Record<string, unknown>) => editIntakeFieldFn({ data: data as never }),
    onSuccess: apply,
    onError,
  });
  const settings = useMutation({
    mutationFn: (data: Record<string, unknown>) => updateIntakeSettingsFn({ data: data as never }),
    onSuccess: apply,
    onError,
  });
  const activate = useMutation({
    mutationFn: (data: { intakeId: string }) => activateIntakeFn({ data }),
    onSuccess: async ({ endeavourId }) => {
      await queryClient.invalidateQueries({ queryKey: datasetQuery.queryKey });
      toast.success("Endeavour activated");
      await navigate({ to: "/endeavours/$id", params: { id: endeavourId } });
    },
    onError,
  });

  const busy = start.isPending || answer.isPending || edit.isPending || settings.isPending || activate.isPending;
  const spec = view?.spec ?? null;
  const unanswered = view?.questions.filter((q) => !q.answer.trim()) ?? [];
  const pendingAnswers = Object.entries(answers)
    .filter(([, a]) => a.trim())
    .map(([field, a]) => ({ field, answer: a }));

  if (appMode === "demo") {
    return (
      <div className="space-y-5">
        <PageHeader title="NEW ENDEAVOUR" />
        <Panel bodyClassName="px-4 py-6">
          <p className="text-[13px] text-muted-foreground">
            Demo mode has no database or planner. Connect a database to define a real endeavour.
          </p>
        </Panel>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="NEW ENDEAVOUR"
          summary="Describe the commercial outcome in your own words. The planner drafts a spec; nothing runs until you approve it."
        />
        <Panel title="BRIEF" bodyClassName="space-y-3 px-4 py-4">
          <textarea
            aria-label="Brief"
            className={inputCls}
            rows={10}
            placeholder="What do you want to achieve, what do you sell, who buys it, by when, and how much outreach a day?"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" disabled={busy || brief.trim().length < 40} onClick={() => start.mutate({ brief })}>
              {start.isPending ? "Planning…" : "Plan this endeavour"}
            </Button>
            <MachineLabel>{brief.trim().length} CHARACTERS · 40 MINIMUM</MachineLabel>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="NEW ENDEAVOUR"
        summary="Every field is yours to confirm. Suggestions and gaps block activation until you resolve them."
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="DRAFT SPEC" bodyClassName="divide-y divide-border">
          {FIELD_ORDER.map((field) => (
            <IntakeFieldRow
              key={field}
              field={field}
              label={FIELD_LABELS[field] ?? field}
              state={spec?.[field] as IntakeFieldState}
              question={view.questions.find((q) => q.field === field)}
              answer={answers[field] ?? ""}
              busy={busy}
              onAnswerChange={(value) => setAnswers((a) => ({ ...a, [field]: value }))}
              onConfirm={() => edit.mutate({ intakeId: view.id, field, action: "confirm" })}
              onNotApplicable={(reason) => edit.mutate({ intakeId: view.id, field, action: "not_applicable", reason })}
              onSet={(value) => edit.mutate({ intakeId: view.id, field, action: "set", value })}
            />
          ))}
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || pendingAnswers.length === 0}
              onClick={() => answer.mutate({ intakeId: view.id, answers: pendingAnswers })}
            >
              {answer.isPending ? "Re-planning…" : `Re-plan with ${pendingAnswers.length} answer${pendingAnswers.length === 1 ? "" : "s"}`}
            </Button>
            <MachineLabel>{unanswered.length} QUESTION(S) OPEN</MachineLabel>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="ENDEAVOUR" bodyClassName="space-y-3 px-4 py-4">
            <label className="block space-y-1.5">
              <MachineLabel>NAME</MachineLabel>
              <input
                aria-label="Endeavour name"
                className={inputCls}
                defaultValue={spec?.name ?? ""}
                onBlur={(e) => e.target.value !== spec?.name && settings.mutate({ intakeId: view.id, name: e.target.value })}
              />
            </label>
            <label className="block space-y-1.5">
              <MachineLabel>KIND</MachineLabel>
              <select
                aria-label="Endeavour kind"
                className={inputCls}
                value={spec?.kind ?? "sprint"}
                onChange={(e) => settings.mutate({ intakeId: view.id, kind: e.target.value })}
              >
                <option value="sprint">SPRINT — one deadline</option>
                <option value="ongoing">ONGOING — reviewed each period</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <MachineLabel>AUTONOMY</MachineLabel>
              <select
                aria-label="Autonomy level"
                className={inputCls}
                value={spec?.autonomyLevel ?? "DRAFT"}
                onChange={(e) => settings.mutate({ intakeId: view.id, autonomyLevel: e.target.value })}
              >
                <option value="OBSERVE">OBSERVE — research only</option>
                <option value="DRAFT">DRAFT — you approve every send</option>
                <option value="GUARDED" disabled>
                  GUARDED — not available in v1
                </option>
                <option value="DELEGATED" disabled>
                  DELEGATED — not available in v1
                </option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <MachineLabel>SENDS FROM</MachineLabel>
              <select
                aria-label="Sending mailbox"
                className={inputCls}
                value={(spec?.mailboxId as IntakeFieldState | undefined)?.state === "confirmed" ? String((spec?.mailboxId as { value: string }).value) : ""}
                onChange={(e) => edit.mutate({ intakeId: view.id, field: "mailboxId", action: "set", value: e.target.value })}
              >
                <option value="">Choose a connected mailbox…</option>
                {mailboxes
                  .filter((m) => m.status === "connected")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.address}
                    </option>
                  ))}
              </select>
            </label>
          </Panel>

          <Panel
            title="ACTIVATION"
            meta={<Tag tone={view.ready ? "signal" : "warn"}>{view.ready ? "READY" : `${view.blockers.length} BLOCKING`}</Tag>}
            bodyClassName="space-y-3 px-4 py-4"
          >
            {view.blockers.length > 0 && (
              <ul className="space-y-1" data-testid="activation-blockers">
                {view.blockers.map((b) => (
                  <li key={`${b.field}-${b.code}`} className="text-[13px] text-warn">
                    {FIELD_LABELS[b.field] ?? b.field}: {b.message}
                  </li>
                ))}
              </ul>
            )}
            <Button
              variant="primary"
              disabled={busy || !view.ready}
              onClick={() => activate.mutate({ intakeId: view.id })}
            >
              {activate.isPending ? "Activating…" : "Activate endeavour"}
            </Button>
            <MachineLabel>ACTIVATION CREATES THE ENDEAVOUR AND ITS FIRST SPEC VERSION</MachineLabel>
          </Panel>
        </div>
      </div>
    </div>
  );
}
