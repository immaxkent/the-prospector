/**
 * What each spec field looks like as a form.
 *
 * The values are ordinary objects with known shapes and, in several places, a fixed set of
 * allowed options. Asking an operator to type that as JSON is asking them to do the
 * computer's job — and to get a comma wrong at nine o'clock at night. Describing the shape
 * once here means every screen that edits a spec gets the same inputs.
 */

/** Shown only when another key of the same object holds one of these values. */
export interface ShowWhen {
  key: string;
  oneOf?: readonly string[];
  noneOf?: readonly string[];
}

interface Common {
  key: string;
  label: string;
  optional?: boolean;
  help?: string;
  showWhen?: ShowWhen;
  /** What a new item starts at. Zero is a poor default for anything that must be positive. */
  default?: unknown;
}

export type Input =
  | (Common & { type: "text" | "textarea" | "number" | "date"; placeholder?: string })
  | (Common & { type: "select"; options: readonly string[] })
  /** A list of plain strings, one per line. */
  | (Common & { type: "strings"; placeholder?: string });

export type FieldForm =
  /** One object with a fixed set of inputs, and an optional tidy-up after every change. */
  | { kind: "object"; inputs: Input[]; normalise?: (value: Record<string, unknown>) => Record<string, unknown> }
  /** One object whose shape depends on a chooser, such as a sprint against an ongoing horizon. */
  | { kind: "variant"; on: string; label: string; variants: Record<string, { label: string; inputs: Input[] }> }
  /** A list of objects, each with the same inputs. */
  | { kind: "list"; itemLabel: string; inputs: Input[] };

const CURRENCIES = ["GBP", "USD", "EUR"] as const;

export const FIELD_FORMS: Record<string, FieldForm> = {
  objective: {
    kind: "object",
    inputs: [
      { key: "metric", label: "Measured in", type: "select", options: ["revenue", "customers", "users", "partners", "meetings", "custom"], default: "revenue" },
      { key: "target", label: "Target", type: "number", help: "The number that means done.", default: 1 },
      // Money is counted in a currency; everything else is counted in whatever it is. Asking
      // for both at once produced two boxes that both said GBP, which explains nothing.
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, showWhen: { key: "metric", oneOf: ["revenue"] }, default: "GBP" },
      {
        key: "unit",
        label: "Counted in",
        type: "text",
        placeholder: "partners, meetings, sign-ups",
        showWhen: { key: "metric", noneOf: ["revenue"] },
        help: "What one counts as.",
      },
    ],
    // A revenue objective is counted in its currency, so the unit follows rather than being asked for.
    normalise: (value) => (value["metric"] === "revenue" ? { ...value, unit: String(value["currency"] ?? "GBP") } : value),
  },

  horizon: {
    kind: "variant",
    on: "kind",
    label: "Kind",
    variants: {
      sprint: { label: "Sprint — one deadline", inputs: [{ key: "endsOn", label: "Ends on", type: "date" }] },
      ongoing: {
        label: "Ongoing — reviewed each period",
        inputs: [
          { key: "period", label: "Period", type: "select", options: ["week", "month", "quarter"] },
          { key: "reviewEvery", label: "Review every", type: "number", help: "How many periods between reviews.", default: 1 },
        ],
      },
    },
  },

  offering: {
    kind: "object",
    inputs: [
      { key: "summary", label: "What you sell", type: "textarea", placeholder: "One line a stranger would understand." },
      { key: "deliverables", label: "What the buyer receives", type: "strings", help: "One per line." },
    ],
  },

  pricing: {
    kind: "object",
    inputs: [
      { key: "model", label: "Model", type: "select", options: ["day_rate", "package", "retainer", "subscription", "rev_share", "free"] },
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, optional: true },
      { key: "minimumDeal", label: "Minimum you would accept", type: "number", optional: true, help: "A floor, not a forecast." },
      { key: "expectedDeal", label: "Typical deal value", type: "number", optional: true, help: "What the daily plan forecasts from, until real deals replace it." },
      { key: "amount", label: "Fixed price", type: "number", optional: true, help: "Only for work with one price. Leave empty otherwise." },
    ],
  },

  proof: {
    kind: "list",
    itemLabel: "Proof",
    inputs: [
      { key: "kind", label: "Kind", type: "select", options: ["repo", "client", "case_study", "product", "metric", "publication"] },
      { key: "title", label: "Title", type: "text" },
      { key: "url", label: "Link", type: "text", optional: true, help: "Something a recipient can open." },
      { key: "claim", label: "What it proves", type: "textarea" },
    ],
  },

  buyers: {
    kind: "list",
    itemLabel: "Buyer",
    inputs: [
      { key: "name", label: "Name", type: "text" },
      { key: "definition", label: "Who they are", type: "textarea" },
      { key: "signals", label: "Signals they need it now", type: "strings", help: "One per line." },
      { key: "painHypothesis", label: "Why it hurts", type: "textarea" },
      { key: "priority", label: "Priority", type: "number", help: "1 is chased first.", default: 1 },
    ],
  },

  exclusions: {
    kind: "list",
    itemLabel: "Exclusion",
    inputs: [
      { key: "rule", label: "Will not contact", type: "textarea" },
      { key: "reason", label: "Why not", type: "textarea" },
    ],
  },

  cadence: {
    kind: "object",
    inputs: [
      { key: "dailyNewTarget", label: "New contacts a day", type: "number", help: "A ceiling: the loop asks for less when the pipeline is full.", default: 10 },
      { key: "dailyFollowupTarget", label: "Follow-ups a day", type: "number", default: 5 },
    ],
  },
};

/** An empty item for a list field, so "add" produces something the inputs can fill. */
export function blankItem(inputs: readonly Input[]): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const input of inputs) {
    if (input.default !== undefined) item[input.key] = input.default;
    else if (input.type === "strings") item[input.key] = [];
    else if (input.type === "select") item[input.key] = input.options[0];
    // Zero is not a safe default: several of these fields must be positive, and starting
    // them at zero means the first save is refused for something nobody chose.
    else if (input.type === "number") item[input.key] = 1;
    else item[input.key] = "";
  }
  return item;
}

/** Whether an input applies, given the rest of the object it belongs to. */
export function isShown(input: Input, value: Record<string, unknown>): boolean {
  const when = input.showWhen;
  if (!when) return true;
  const other = String(value[when.key] ?? "");
  if (when.oneOf && !when.oneOf.includes(other)) return false;
  if (when.noneOf && when.noneOf.includes(other)) return false;
  return true;
}

/**
 * Turns what an input holds into what the schema expects. Empty optional fields are dropped
 * rather than sent as empty strings, which is what the schema would reject.
 */
export function coerce(input: Input, raw: string): unknown {
  if (input.type === "strings") return raw.split("\n").map((line) => line.trim()).filter(Boolean);
  if (input.type === "number") {
    const value = Number(raw);
    return raw.trim() === "" ? undefined : Number.isFinite(value) ? value : undefined;
  }
  const text = raw.trim();
  return text === "" ? undefined : text;
}

/** Drops the keys an optional empty input left behind. */
export function withoutEmpties(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== ""));
}

/** How a value reads in an input: lists one per line, everything else as itself. */
export function display(input: Input, value: unknown): string {
  if (input.type === "strings") return Array.isArray(value) ? value.join("\n") : "";
  return value === undefined || value === null ? "" : String(value);
}
