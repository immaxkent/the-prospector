export function gbp(value: number, opts: { compact?: boolean } = {}) {
  if (opts.compact) {
    const absolute = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (absolute >= 1_000_000) return `${sign}£${trimCompact(absolute / 1_000_000)}M`;
    if (absolute >= 1_000) return `${sign}£${trimCompact(absolute / 1_000)}K`;
    return `${sign}£${Math.round(absolute)}`;
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
    notation: opts.compact ? "compact" : "standard",
  }).format(value);
}

function trimCompact(value: number) {
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
}

export function num(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

export function pct(value: number, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function clockTime(iso: string) {
  if (!iso) return "--:--:--";
  return new Date(iso).toISOString().slice(11, 19);
}

export function stamp(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

export function shortDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();
}

export function relative(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

export function daysUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}
