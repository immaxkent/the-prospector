import type { ActivityEvent, ActivityKind } from "@/data/types";
import { clockTime } from "@/lib/format";
import { MachineLabel } from "./primitives";
import { cn } from "@/lib/utils";

const kindTone: Record<ActivityKind, string> = {
  RESEARCHED: "text-muted-foreground",
  QUALIFIED: "text-signal",
  DRAFTED: "text-foreground",
  SENT: "text-foreground",
  REPLY_RECEIVED: "text-signal",
  FOLLOWUP_DUE: "text-warn",
  MEETING_SET: "text-signal",
  WON: "text-primary",
  RUN_FAILED: "text-danger",
};

/** Source: activity queue (ActivityEvent records). */
export function ActivityTape({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <MachineLabel>NO ACTIVITY RECORDED</MachineLabel>
      </div>
    );
  }
  return (
    <ul className="hairline-y">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-3 px-4 py-2">
          <span className="numeral shrink-0 text-[11px] text-muted-foreground">{clockTime(e.at)}</span>
          <span className={cn("machine w-[124px] shrink-0", kindTone[e.kind])}>{e.kind}</span>
          <span className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-foreground">{e.subject}</span>
            <span className="text-muted-foreground"> — {e.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
