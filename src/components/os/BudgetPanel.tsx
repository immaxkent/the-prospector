import { useState } from "react";
import { toast } from "sonner";
import { useUpdateSettings } from "@/data/mutations";
import { useAppMode, useDataset } from "@/data/store";
import { SELECTABLE_MODELS } from "@/data/models";
import { Button, MachineLabel, Meter } from "./primitives";

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`;

const REASONS: Record<string, string> = {
  daily_budget_spent: "Today's share is spent. The loop picks up tomorrow.",
  monthly_budget_spent: "This month's budget is spent. Raise it here or wait for the new month.",
  no_budget: "No budget is set, so nothing that needs Claude will run.",
};

/**
 * What the model costs and what it is allowed to cost. The month is spread over its days,
 * so a single busy day cannot eat the month.
 */
export function BudgetPanel() {
  const mode = useAppMode();
  const { status } = useDataset();
  const b = status.budget;
  const save = useUpdateSettings();
  const [form, setForm] = useState({ model: b.model, monthly: (b.monthlyBudgetPence / 100).toFixed(2) });

  const monthlyPence = Math.round(Number(form.monthly) * 100);
  const valid = Number.isFinite(monthlyPence) && monthlyPence >= 0 && monthlyPence <= 100_000;
  const changed = form.model !== b.model || monthlyPence !== b.monthlyBudgetPence;
  const perDay = valid ? Math.floor(monthlyPence / 30) : 0;

  return (
    <div className="space-y-3 px-4 py-4" data-testid="budget-panel">
      <div className="space-y-1.5">
        <MachineLabel>
          TODAY {pounds(b.spentTodayPence)} OF {pounds(b.dailyAllowancePence)} · THIS MONTH{" "}
          {pounds(b.spentMonthPence)} OF {pounds(b.monthlyBudgetPence)}
        </MachineLabel>
        <Meter value={b.dailyAllowancePence === 0 ? 0 : b.spentTodayPence / b.dailyAllowancePence} />
        {!b.allowed && <p className="text-[13px] text-warn">{REASONS[b.reason] ?? "The budget is spent."}</p>}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="space-y-1">
          <MachineLabel>MODEL</MachineLabel>
          <select
            aria-label="Model"
            className="w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          >
            {SELECTABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.note}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <MachineLabel>BUDGET A MONTH (£)</MachineLabel>
          <input
            aria-label="Monthly budget"
            className="numeral w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal"
            value={form.monthly}
            onChange={(e) => setForm((f) => ({ ...f, monthly: e.target.value }))}
          />
        </label>
      </div>

      <MachineLabel className="block">
        {valid ? `ABOUT ${pounds(perDay)} A DAY` : "THAT IS NOT A BUDGET THIS APP WILL SET"} · CONVERTED AT $
        {b.usdPerGbp.toFixed(2)} TO THE POUND
      </MachineLabel>

      <Button
        variant="primary"
        size="sm"
        disabled={save.isPending || !valid || !changed}
        onClick={() => {
          if (mode === "demo") {
            toast("Demo mode: nothing was saved");
            return;
          }
          save.mutate({ model: form.model, monthlyBudgetPence: monthlyPence });
        }}
      >
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
