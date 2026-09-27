import { useState } from "react";
import { MachineLabel } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * Two charts, drawn as SVG rather than pulled from a chart library.
 *
 * The house marks are thin, the axes recessive and the fills gradient — every default a
 * library ships would have to be overridden to get there, and the overrides would be
 * longer than the drawing.
 *
 * The two series colours were checked rather than chosen by eye: gold #CB7B25 and teal
 * #2AA39E sit inside the dark-mode lightness band, clear the chroma floor, and separate
 * by ΔE 14.9 under protanopia and 21.6 in normal vision against the #091115 panel. Both
 * series are also directly labelled, so identity never rests on colour alone.
 */
export const SERIES = { primary: "#CB7B25", secondary: "#2AA39E" } as const;

const AXIS = "oklch(0.965 0.008 205 / 0.14)";
const INK = "oklch(0.965 0.008 205 / 0.45)";

/* ---------- funnel ---------- */

export interface FunnelStage {
  label: string;
  value: number;
}

/**
 * Where the pipeline leaks.
 *
 * Horizontal bars in stage order, not a tapered funnel: a taper encodes the same number
 * twice — once as width and once as area — and the eye reads the area, which is the wrong
 * one. Each bar carries its own count and the share that survived the previous stage,
 * because the drop between two stages is the thing worth seeing and asking a reader to
 * divide two bars by eye is asking them to do the arithmetic.
 */
export function FunnelChart({ stages }: { stages: readonly FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="space-y-1.5" data-testid="funnel-chart">
      {stages.map((stage, i) => {
        const previous = stages[i - 1];
        // A stage nobody reached has no conversion to report — 0/0 is not 0%.
        const kept = previous && previous.value > 0 ? Math.round((stage.value / previous.value) * 100) : null;
        const width = (stage.value / max) * 100;
        return (
          <div
            key={stage.label}
            className="group grid grid-cols-[104px_minmax(0,1fr)_92px] items-center gap-3"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <MachineLabel className={cn("truncate transition-colors", hover === i && "text-foreground")}>
              {stage.label}
            </MachineLabel>
            <div className="relative h-5 rounded-[3px] bg-white/[0.03]">
              <div
                className="h-full rounded-[3px] transition-[filter] duration-200"
                style={{
                  width: `${Math.max(width, stage.value > 0 ? 1.5 : 0)}%`,
                  background: `linear-gradient(90deg, ${SERIES.primary}CC, ${SERIES.primary}77)`,
                  filter: hover === i ? "brightness(1.25)" : "none",
                }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] tabular-nums text-foreground/85">
                {stage.value}
              </span>
            </div>
            <MachineLabel className="text-right text-foreground/40">
              {kept === null ? "—" : `${kept}% KEPT`}
            </MachineLabel>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- activity over time ---------- */

export interface DayPoint {
  /** ISO date, used for the tooltip and the axis. */
  date: string;
  sent: number;
  replies: number;
}

const W = 640;
const H = 150;
const PAD = { top: 10, right: 8, bottom: 20, left: 26 };

/**
 * Sent and replies, by day.
 *
 * Both series are counts of messages, so they share one axis — two scales would let the
 * smaller series be drawn as tall as the larger and quietly invert the comparison.
 */
export function ActivityChart({ days }: { days: readonly DayPoint[] }) {
  const [at, setAt] = useState<number | null>(null);
  if (days.length === 0) return <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing sent yet.</p>;

  const max = Math.max(...days.flatMap((d) => [d.sent, d.replies]), 1);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // A single day has no width to spread over, so it sits in the middle rather than at x=0.
  const x = (i: number) => (days.length === 1 ? PAD.left + plotW / 2 : PAD.left + (i / (days.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const path = (key: "sent" | "replies") => days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d[key])}`).join(" ");
  // Counts are whole, so the ticks are too — and rounding a midpoint of 1 gave an axis
  // labelled 1, 1, 0. Below four, every integer is a tick; above it, three evenly spaced.
  const ticks =
    max <= 3
      ? Array.from({ length: max + 1 }, (_, i) => i)
      : [...new Set([0, Math.round(max / 2), max])];

  const current = at === null ? null : days[at];

  return (
    <div className="relative" data-testid="activity-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Messages sent and replies received over the last ${days.length} days`}
        onMouseLeave={() => setAt(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const local = ((event.clientX - box.left) / box.width) * W;
          const step = days.length === 1 ? plotW : plotW / (days.length - 1);
          setAt(Math.min(days.length - 1, Math.max(0, Math.round((local - PAD.left) / step))));
        }}
      >
        {/* Recessive gridlines: enough to read a height against, not graph paper. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={AXIS} strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={INK} className="machine">
              {t}
            </text>
          </g>
        ))}

        {current && <line x1={x(at!)} x2={x(at!)} y1={PAD.top} y2={PAD.top + plotH} stroke={AXIS} strokeWidth="1" />}

        <path d={path("sent")} fill="none" stroke={SERIES.primary} strokeWidth="2" strokeLinejoin="round" />
        <path d={path("replies")} fill="none" stroke={SERIES.secondary} strokeWidth="2" strokeLinejoin="round" />

        {current && (
          <>
            {/* A 2px surface ring keeps the marker readable where the two lines cross. */}
            <circle cx={x(at!)} cy={y(current.sent)} r="4" fill={SERIES.primary} stroke="#091115" strokeWidth="2" />
            <circle cx={x(at!)} cy={y(current.replies)} r="4" fill={SERIES.secondary} stroke="#091115" strokeWidth="2" />
          </>
        )}

        <text x={PAD.left} y={H - 6} fontSize="9" fill={INK} className="machine">
          {days[0]!.date.slice(5)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="9" fill={INK} className="machine">
          {days[days.length - 1]!.date.slice(5)}
        </text>
      </svg>

      {/* The legend is always present, and both series are named rather than only coloured. */}
      <div className="mt-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {(
            [
              ["SENT", SERIES.primary, current?.sent],
              ["REPLIES", SERIES.secondary, current?.replies],
            ] as const
          ).map(([label, colour, value]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-[2px] w-3 rounded-full" style={{ background: colour }} />
              <MachineLabel>{label}</MachineLabel>
              {value !== undefined && <span className="text-[12px] tabular-nums text-foreground">{value}</span>}
            </span>
          ))}
        </div>
        <MachineLabel className="text-foreground/40">{current ? current.date : `${days.length} DAYS`}</MachineLabel>
      </div>
    </div>
  );
}
