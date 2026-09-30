import { useState } from "react";
import { toast } from "sonner";
import type { Endeavour } from "@/data/types";
import { useUpdateEndeavourSettings } from "@/data/mutations";
import { useAppMode } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

const hours = Array.from({ length: 25 }, (_, i) => i);
const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * How this endeavour paces itself. These are dials, not strategy: changing one does not create
 * a spec version, and every value is defaulted so an endeavour is sensible before it is touched.
 */
export function EndeavourConfig({ endeavour }: { endeavour: Endeavour }) {
  const mode = useAppMode();
  const save = useUpdateEndeavourSettings();
  const s = endeavour.settings;
  const [form, setForm] = useState({
    startHour: s.pacing.window.startHour,
    endHour: s.pacing.window.endHour,
    minGapMinutes: String(s.pacing.minGapMinutes),
    maxGapMinutes: String(s.pacing.maxGapMinutes),
    useRecipientTimezone: s.pacing.useRecipientTimezone,
    minReplyDelayMinutes: String(s.pacing.minReplyDelayMinutes),
    followUpDays: s.followUpDays.join(", "),
    maximumPending: String(s.prospecting.maximumPending),
    activeGoal: String(s.prospecting.activeGoal),
    prospectingPaused: s.prospecting.paused,
  });

  const maximumPending = Number(form.maximumPending);
  const activeGoal = Number(form.activeGoal);
  const minGap = Number(form.minGapMinutes);
  const maxGap = Number(form.maxGapMinutes);
  const replyDelay = Number(form.minReplyDelayMinutes);
  const followUpDays = form.followUpDays
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);

  const problem =
    form.endHour <= form.startHour
      ? "The window has to close after it opens."
      : !Number.isInteger(minGap) || minGap < 1 || minGap > 240
        ? "The shortest gap must be between 1 and 240 minutes."
        : !Number.isInteger(maxGap) || maxGap < minGap || maxGap > 240
          ? "The longest gap cannot be shorter than the shortest."
          : !Number.isInteger(replyDelay) || replyDelay < 0
            ? "The reply delay cannot be negative."
            : followUpDays.some((d) => !Number.isInteger(d) || d < 1 || d > 180)
              ? "Follow-up days must be whole numbers between 1 and 180."
              : followUpDays.length > 6
                ? "Six follow-ups is the most one prospect will get."
                : !Number.isInteger(maximumPending) || maximumPending < 1 || maximumPending > 500
                  ? "Pending prospects must be a whole number between 1 and 500."
                  : !Number.isInteger(activeGoal) || activeGoal < 1 || activeGoal > 200
                    ? "The goal for live conversations must be a whole number between 1 and 200."
                    : null;

  const archived = endeavour.status === "archived";
  const perHour = maxGap > 0 ? Math.round((60 / ((minGap + maxGap) / 2)) * 10) / 10 : 0;

  return (
    <div className="space-y-4 px-4 py-4" data-testid="endeavour-config">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <MachineLabel>SENDS FROM</MachineLabel>
          <select
            aria-label="Window opens"
            className={inputCls}
            value={form.startHour}
            onChange={(e) => setForm((f) => ({ ...f, startHour: Number(e.target.value) }))}
          >
            {hours.slice(0, 24).map((h) => (
              <option key={h} value={h}>
                {pad(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <MachineLabel>UNTIL</MachineLabel>
          <select
            aria-label="Window closes"
            className={inputCls}
            value={form.endHour}
            onChange={(e) => setForm((f) => ({ ...f, endHour: Number(e.target.value) }))}
          >
            {hours.slice(1).map((h) => (
              <option key={h} value={h}>
                {pad(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <MachineLabel>SHORTEST GAP (MIN)</MachineLabel>
          <input
            aria-label="Shortest gap"
            className={`${inputCls} numeral`}
            value={form.minGapMinutes}
            onChange={(e) => setForm((f) => ({ ...f, minGapMinutes: e.target.value }))}
          />
        </label>
        <label className="space-y-1">
          <MachineLabel>LONGEST GAP (MIN)</MachineLabel>
          <input
            aria-label="Longest gap"
            className={`${inputCls} numeral`}
            value={form.maxGapMinutes}
            onChange={(e) => setForm((f) => ({ ...f, maxGapMinutes: e.target.value }))}
          />
        </label>
        <label className="space-y-1">
          <MachineLabel>WAIT BEFORE REPLYING (MIN)</MachineLabel>
          <input
            aria-label="Reply delay"
            className={`${inputCls} numeral`}
            value={form.minReplyDelayMinutes}
            onChange={(e) => setForm((f) => ({ ...f, minReplyDelayMinutes: e.target.value }))}
          />
        </label>
        <label className="space-y-1">
          <MachineLabel>FOLLOW UP AFTER (DAYS)</MachineLabel>
          <input
            aria-label="Follow-up days"
            className={inputCls}
            placeholder="3, 7, 14"
            value={form.followUpDays}
            onChange={(e) => setForm((f) => ({ ...f, followUpDays: e.target.value }))}
          />
        </label>
      </div>

      <label className="flex items-center gap-2">
        <input
          aria-label="Send in the recipient's morning"
          type="checkbox"
          checked={form.useRecipientTimezone}
          onChange={(e) => setForm((f) => ({ ...f, useRecipientTimezone: e.target.checked }))}
        />
        <MachineLabel>SEND IN THE RECIPIENT'S MORNING WHERE WE KNOW THEIR TIMEZONE</MachineLabel>
      </label>

      <div className="space-y-3 border-t border-border pt-4">
        <MachineLabel>HOW MUCH WORK SITS IN FRONT OF YOU</MachineLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <MachineLabel>MOST PENDING PROSPECTS</MachineLabel>
            <input
              aria-label="Most pending prospects"
              className={inputCls}
              inputMode="numeric"
              value={form.maximumPending}
              onChange={(e) => setForm((f) => ({ ...f, maximumPending: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <MachineLabel>LIVE CONVERSATIONS WANTED</MachineLabel>
            <input
              aria-label="Live conversations wanted"
              className={inputCls}
              inputMode="numeric"
              value={form.activeGoal}
              onChange={(e) => setForm((f) => ({ ...f, activeGoal: e.target.value }))}
            />
          </label>
        </div>

        <label className="flex items-center gap-2">
          <input
            aria-label="Pause prospecting"
            type="checkbox"
            checked={form.prospectingPaused}
            onChange={(e) => setForm((f) => ({ ...f, prospectingPaused: e.target.checked }))}
          />
          <MachineLabel>PAUSE PROSPECTING</MachineLabel>
        </label>

        <p className="text-[13px] text-muted-foreground" data-testid="prospecting-summary">
          {form.prospectingPaused ? (
            <>Prospecting is paused. Nothing new will be looked for until you turn it back on.</>
          ) : (
            <>
              Up to {maximumPending || 0} prospect{maximumPending === 1 ? "" : "s"} may be waiting on you at once,
              counting ones nobody has released yet. Looking stops when that is full, or once{" "}
              {activeGoal || 0} conversation{activeGoal === 1 ? " is" : "s are"} live. Nothing leaves the list on its
              own — the weekly review asks you about anything that has gone quiet.
            </>
          )}
        </p>
      </div>

      <p className="text-[13px] text-muted-foreground">
        {problem ?? (
          <>
            About {perHour} email{perHour === 1 ? "" : "s"} an hour, at uneven intervals, between {pad(form.startHour)} and{" "}
            {pad(form.endHour)}
            {form.useRecipientTimezone ? " where the recipient is" : " on the mailbox's clock"}. The window and the gaps
            are what stop a day's outreach arriving as one identical burst.
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={save.isPending || !!problem || archived}
          onClick={() => {
            if (mode === "demo") {
              toast("Demo mode: nothing was saved");
              return;
            }
            save.mutate({
              endeavourId: endeavour.id,
              pacing: {
                window: { startHour: form.startHour, endHour: form.endHour },
                minGapMinutes: minGap,
                maxGapMinutes: maxGap,
                useRecipientTimezone: form.useRecipientTimezone,
                minReplyDelayMinutes: replyDelay,
              },
              followUpDays,
              prospecting: { maximumPending, activeGoal, paused: form.prospectingPaused },
            });
          }}
        >
          {save.isPending ? "Saving…" : "Save configuration"}
        </Button>
        {archived && <MachineLabel className="self-center">ARCHIVED: CONFIGURATION CANNOT CHANGE</MachineLabel>}
      </div>
    </div>
  );
}
