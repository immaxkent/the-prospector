import { useState } from "react";
import { Button, MachineLabel, Tag } from "./primitives";

export type IntakeFieldState =
  | { state: "stated"; value: unknown; quote: string }
  | { state: "confirmed"; value: unknown }
  | { state: "not_applicable"; reason: string }
  | { state: "suggested"; value: unknown; rationale: string }
  | { state: "missing" };

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

const TONE = { stated: "signal", confirmed: "signal", suggested: "warn", missing: "danger", not_applicable: "neutral" } as const;
const NOT_APPLICABLE_ALLOWED = new Set(["pricing", "proof"]);

/** Readable one-liner for a field value; the JSON editor shows the full shape. */
export function summarise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(summarise).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${k}: ${summarise(v)}`)
      .join(", ");
  }
  return String(value);
}

export interface IntakeQuestion {
  field: string;
  question: string;
  answer: string;
}

/** One field of the draft: its state, what the planner said, and the operator's controls. */
export function IntakeFieldRow({
  field,
  label,
  state,
  question,
  answer,
  busy,
  onAnswerChange,
  onConfirm,
  onNotApplicable,
  onSet,
}: {
  field: string;
  label: string;
  state: IntakeFieldState | undefined;
  question: IntakeQuestion | undefined;
  answer: string;
  busy: boolean;
  onAnswerChange: (value: string) => void;
  onConfirm: () => void;
  onNotApplicable: (reason: string) => void;
  onSet: (value: unknown) => void;
}) {
  const [panel, setPanel] = useState<"none" | "edit" | "na">("none");
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  if (!state) return null;

  const value = "value" in state ? state.value : undefined;
  const openEditor = () => {
    setDraft(JSON.stringify(value ?? null, null, 2));
    setJsonError(null);
    setPanel("edit");
  };
  const save = () => {
    try {
      onSet(JSON.parse(draft));
      setPanel("none");
    } catch {
      setJsonError("That is not valid JSON.");
    }
  };

  return (
    <div className="px-4 py-3" data-testid={`intake-field-${field}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        <Tag tone={TONE[state.state]}>{state.state.replace("_", " ").toUpperCase()}</Tag>
      </div>

      {state.state === "not_applicable" ? (
        <p className="machine mt-1.5 normal-case tracking-normal">NOT APPLICABLE — {state.reason}</p>
      ) : state.state === "missing" ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">Nothing proposed. Answer the question or enter a value.</p>
      ) : (
        <p className="mt-1.5 text-[13px]">{summarise(value)}</p>
      )}

      {state.state === "stated" && <p className="machine mt-1 normal-case tracking-normal">QUOTED: “{state.quote}”</p>}
      {state.state === "suggested" && <p className="machine mt-1 normal-case tracking-normal">SUGGESTED: {state.rationale}</p>}

      {question && state.state !== "confirmed" && state.state !== "not_applicable" && (
        <div className="mt-2 space-y-1.5">
          <MachineLabel>{question.question}</MachineLabel>
          <input
            aria-label={`Answer for ${label}`}
            className={inputCls}
            placeholder="Your answer"
            value={answer}
            onChange={(e) => onAnswerChange(e.target.value)}
          />
        </div>
      )}

      {panel === "edit" && (
        <div className="mt-2 space-y-1.5">
          <MachineLabel>VALUE (JSON)</MachineLabel>
          <textarea aria-label={`Value for ${label}`} className={`${inputCls} font-mono`} rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {jsonError && <p className="text-[12px] text-warn">{jsonError}</p>}
        </div>
      )}
      {panel === "na" && (
        <input
          aria-label={`Reason ${label} does not apply`}
          className={`${inputCls} mt-2`}
          placeholder="Why does this not apply?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {panel === "edit" ? (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={save}>
              Save value
            </Button>
            <Button size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </>
        ) : panel === "na" ? (
          <>
            <Button variant="primary" size="sm" disabled={busy || !reason.trim()} onClick={() => onNotApplicable(reason)}>
              Confirm not applicable
            </Button>
            <Button size="sm" onClick={() => setPanel("none")}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {(state.state === "stated" || state.state === "suggested") && (
              <Button variant="primary" size="sm" disabled={busy} onClick={onConfirm}>
                Confirm
              </Button>
            )}
            <Button size="sm" disabled={busy} onClick={openEditor}>
              {state.state === "missing" || state.state === "not_applicable" ? "Enter value" : "Edit"}
            </Button>
            {NOT_APPLICABLE_ALLOWED.has(field) && state.state !== "not_applicable" && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPanel("na")}>
                Not applicable
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
