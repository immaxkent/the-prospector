import { Button, MachineLabel } from "./primitives";
import { FIELD_FORMS, blankItem, coerce, display, isShown, withoutEmpties, type Input } from "./spec-forms";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-signal";

/** One input, reading and writing a single key of the object it belongs to. */
function Field({
  input,
  value,
  onChange,
  disabled,
}: {
  input: Input;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled: boolean;
}) {
  const shown = display(input, value);
  const set = (raw: string) => onChange(coerce(input, raw));

  return (
    <label className="block space-y-1">
      <MachineLabel>
        {input.label}
        {"optional" in input && input.optional ? " · OPTIONAL" : ""}
      </MachineLabel>

      {input.type === "select" ? (
        <select aria-label={input.label} className={inputCls} value={shown} disabled={disabled} onChange={(e) => set(e.target.value)}>
          {input.optional && <option value="">—</option>}
          {input.options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      ) : input.type === "textarea" || input.type === "strings" ? (
        <textarea
          aria-label={input.label}
          className={inputCls}
          rows={input.type === "strings" ? 4 : 2}
          value={shown}
          disabled={disabled}
          placeholder={"placeholder" in input ? input.placeholder : undefined}
          onChange={(e) => set(e.target.value)}
        />
      ) : (
        <input
          aria-label={input.label}
          className={inputCls}
          type={input.type === "number" ? "number" : input.type === "date" ? "date" : "text"}
          value={shown}
          disabled={disabled}
          placeholder={"placeholder" in input ? input.placeholder : undefined}
          onChange={(e) => set(e.target.value)}
        />
      )}

      {input.help && <span className="machine block normal-case tracking-normal text-muted-foreground">{input.help}</span>}
    </label>
  );
}

/**
 * A form for one spec field, built from its description rather than written eight times.
 * Returns null for a field with no description, so the caller can fall back to raw JSON.
 */
export function SpecForm({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: string;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  const form = FIELD_FORMS[field];
  if (!form) return null;

  if (form.kind === "object") {
    const object = (value ?? {}) as Record<string, unknown>;
    const update = (key: string, next: unknown) => {
      const merged = withoutEmpties({ ...object, [key]: next });
      onChange(form.normalise ? form.normalise(merged) : merged);
    };
    return (
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {form.inputs
          .filter((input) => isShown(input, object))
          .map((input) => (
            <Field key={input.key} input={input} value={object[input.key]} disabled={disabled} onChange={(next) => update(input.key, next)} />
          ))}
      </div>
    );
  }

  if (form.kind === "variant") {
    const object = (value ?? {}) as Record<string, unknown>;
    const chosen = String(object[form.on] ?? Object.keys(form.variants)[0]);
    const variant = form.variants[chosen] ?? Object.values(form.variants)[0]!;
    return (
      <div className="space-y-2">
        <label className="block space-y-1">
          <MachineLabel>{form.label}</MachineLabel>
          <select
            aria-label={form.label}
            className={inputCls}
            value={chosen}
            disabled={disabled}
            // Switching kind starts the other shape clean: a sprint's end date is not an
            // ongoing endeavour's review period, and keeping it would only fail validation.
            onChange={(e) => onChange({ [form.on]: e.target.value, ...blankItem(form.variants[e.target.value]?.inputs ?? []) })}
          >
            {Object.entries(form.variants).map(([key, v]) => (
              <option key={key} value={key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {variant.inputs.map((input) => (
            <Field
              key={input.key}
              input={input}
              value={object[input.key]}
              disabled={disabled}
              onChange={(next) => onChange(withoutEmpties({ ...object, [form.on]: chosen, [input.key]: next }))}
            />
          ))}
        </div>
      </div>
    );
  }

  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const replace = (index: number, next: Record<string, unknown>) =>
    onChange(items.map((item, i) => (i === index ? next : item)));

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="space-y-2 rounded-[3px] border border-border p-2">
          <div className="flex items-center justify-between">
            <MachineLabel>
              {form.itemLabel} {index + 1}
            </MachineLabel>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(items.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {form.inputs
              .filter((input) => isShown(input, item))
              .map((input) => (
                <Field
                  key={input.key}
                  input={input}
                  value={item[input.key]}
                  disabled={disabled}
                  onChange={(next) => replace(index, withoutEmpties({ ...item, [input.key]: next }))}
                />
              ))}
          </div>
        </div>
      ))}
      <Button size="sm" disabled={disabled} onClick={() => onChange([...items, blankItem(form.inputs)])}>
        Add {form.itemLabel.toLowerCase()}
      </Button>
      {items.length === 0 && (
        <MachineLabel className="block">NOTHING HERE YET — ADD ONE, OR MARK THE FIELD NOT APPLICABLE</MachineLabel>
      )}
    </div>
  );
}
