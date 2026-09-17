import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ---------- MachineLabel ---------- */
export function MachineLabel({
  children,
  className,
  tone = "muted",
}: {
  children: ReactNode;
  className?: string | undefined;
  tone?: "muted" | "ink" | "signal" | undefined;
}) {
  return (
    <span
      className={cn(
        "machine",
        tone === "ink" && "text-foreground",
        tone === "signal" && "text-signal",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- StatusDot ---------- */
const dotTone: Record<string, string> = {
  ok: "bg-signal",
  warn: "bg-warn",
  error: "bg-danger",
  idle: "bg-muted-foreground",
};

export function StatusDot({
  tone = "ok",
  live = false,
  className,
}: {
  tone?: keyof typeof dotTone | undefined;
  live?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn("inline-block h-[6px] w-[6px] rounded-full", dotTone[tone], live && "live-dot", className)}
    />
  );
}

/* ---------- Panel ---------- */
export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string | undefined;
  meta?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}) {
  return (
    <section className={cn("island overflow-hidden rounded-2xl", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-baseline gap-3">
            {title && <MachineLabel tone="ink">{title}</MachineLabel>}
            {meta}
          </div>
          {actions}
        </header>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- MetricCell ---------- */
export function MetricCell({
  label,
  value,
  sub,
  tone = "default",
  size = "md",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
  tone?: "default" | "signal" | "warn" | "danger" | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <MachineLabel>{label}</MachineLabel>
      <div
        className={cn(
          "numeral leading-none",
          size === "sm" && "text-lg",
          size === "md" && "text-2xl",
          size === "lg" && "text-[32px]",
          tone === "signal" && "text-signal",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      {sub && <div className="machine">{sub}</div>}
    </div>
  );
}

/* ---------- Button ---------- */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | undefined;
  size?: "sm" | "md" | undefined;
}) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-200 active:scale-[0.97] disabled:opacity-40",
        size === "sm" ? "h-7 px-3" : "h-8 px-4",
        variant === "primary" &&
          "bg-ink text-ink-foreground shadow-[0_10px_24px_-14px_var(--ink)] hover:bg-primary",
        variant === "secondary" && "border border-border bg-card text-foreground backdrop-blur hover:bg-accent",
        variant === "ghost" && "text-muted-foreground hover:text-foreground",
        variant === "destructive" && "border border-danger/40 text-danger hover:bg-danger/5",
        className,
      )}
    />
  );
}

/* ---------- LedgerTable ---------- */
export function LedgerTable({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode | undefined;
  align?: "left" | "right" | "center" | undefined;
  className?: string | undefined;
}) {
  return (
    <th
      className={cn(
        "machine sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface-2 px-3 py-2.5 font-normal backdrop-blur-md",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono,
  className,
}: {
  children?: ReactNode | undefined;
  align?: "left" | "right" | "center" | undefined;
  mono?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <td
      className={cn(
        "border-b border-border px-3 py-2.5 align-middle",
        mono && "numeral text-[13px]",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  onClick,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  active?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "transition-colors duration-150",
        onClick && "cursor-pointer outline-none hover:bg-accent focus-visible:bg-accent",
        active && "bg-signal-soft",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/* ---------- EvidenceChip ---------- */
export function EvidenceChip({ label, title }: { label: string; title?: string | undefined }) {
  return (
    <span
      title={title}
      className="machine inline-flex max-w-full items-center gap-1 truncate rounded-[3px] border border-border bg-surface-2 px-1.5 py-0.5 text-foreground/80"
    >
      <span className="text-signal">◦</span>
      {label}
    </span>
  );
}

/* ---------- Progress bar ---------- */
export function Meter({ value, tone = "signal" }: { value: number; tone?: "signal" | "warn" | "danger" | undefined }) {
  return (
    <div className="h-[6px] w-full rounded-[2px] bg-muted">
      <div
        className={cn(
          "h-full rounded-[2px] transition-all",
          tone === "signal" && "bg-signal",
          tone === "warn" && "bg-warn",
          tone === "danger" && "bg-danger",
        )}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

/* ---------- Tag ---------- */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "signal" | "warn" | "danger" | "cyan" | undefined;
}) {
  return (
    <span
      className={cn(
        "machine inline-flex items-center rounded-[3px] border px-1.5 py-0.5",
        tone === "neutral" && "border-border text-muted-foreground",
        tone === "signal" && "border-signal/40 bg-signal-soft text-primary",
        tone === "warn" && "border-warn/40 bg-warn-soft text-warn",
        tone === "danger" && "border-danger/40 text-danger",
        tone === "cyan" && "border-cyan/50 text-cyan",
      )}
    >
      {children}
    </span>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode | undefined;
}) {
  return (
    <div className="island relative overflow-hidden rounded-3xl">
      <div className="grid-field pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-start gap-4 px-10 py-20">
        <MachineLabel tone="signal">{title}</MachineLabel>
        <p className="display max-w-xl text-[19px] leading-relaxed text-foreground/80">{body}</p>
        {action}
      </div>
    </div>
  );
}

/* ---------- FunnelStrip ---------- */
export function FunnelStrip({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="flex items-end gap-px">
      {stages.map((s) => (
        <div key={s.label} className="flex flex-1 flex-col gap-1.5">
          <div className="numeral text-[13px]">{s.value}</div>
          <div className="h-12 w-full bg-muted">
            <div
              className="w-full bg-signal/70"
              style={{ height: `${(s.value / max) * 100}%`, marginTop: `${100 - (s.value / max) * 100}%` }}
            />
          </div>
          <MachineLabel className="truncate">{s.label}</MachineLabel>
        </div>
      ))}
    </div>
  );
}

/* ---------- RunIndicator ---------- */
export function RunIndicator({ running }: { running: boolean }) {
  if (!running) return <div className="h-[2px] w-full bg-border" />;
  return <div className="scanline h-[2px] w-full bg-border" />;
}

/* ---------- InspectorPanel ---------- */
export function InspectorPanel({
  open,
  onClose,
  title,
  meta,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  meta?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
}) {
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/10 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />
      <aside className="island rise fixed right-3 top-3 z-50 flex h-[calc(100vh-24px)] w-[calc(100%-24px)] max-w-[540px] flex-col overflow-hidden rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="display text-[20px] font-medium">{title}</h2>
            {meta && <div className="mt-1.5">{meta}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close inspector">
            ESC ✕
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="border-t border-border px-6 py-4">{footer}</footer>}
      </aside>
    </>
  );
}

/* ---------- Section within inspector / brief ---------- */
export function BriefSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-border py-4 first:pt-0 last:border-b-0">
      <MachineLabel tone="signal">{title}</MachineLabel>
      <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

/* ---------- PageHeader ---------- */
export function PageHeader({
  title,
  summary,
  actions,
}: {
  title: string;
  summary?: ReactNode | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="display text-[26px] font-medium leading-none text-foreground">{title}</h1>
        {summary && <p className="mt-3 text-[14px] text-muted-foreground">{summary}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
