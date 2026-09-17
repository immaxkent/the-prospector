import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { runNowFn } from "@/api/runs";
import { errorMessage } from "@/data/mutations";
import { datasetQuery } from "@/data/queries";
import { dismissRun, startRun, useAppMode, useDataset, useRunState } from "@/data/store";
import { Button, StatusDot } from "./primitives";

const PHASE_LABELS: Record<string, string> = {
  load: "LOADING ENDEAVOUR",
  review_yesterday: "REVIEWING OUTSTANDING WORK",
  process_inbound: "READING REPLIES",
  recalculate: "RECALCULATING PIPELINE",
  research: "RESEARCHING PROSPECTS",
  qualify: "QUALIFYING",
  build_queue: "BUILDING TODAY'S QUEUE",
  draft: "DRAFTING OUTREACH",
  send: "SENDING APPROVED MESSAGES",
  escalate: "CHECKING ESCALATIONS",
  learn: "LEARNING FROM REPLIES",
  brief: "WRITING THE DAILY BRIEF",
  done: "RUN COMPLETE",
};

/** RUN NOW plus the live state of the most recent run. */
export function RunNowControl() {
  const mode = useAppMode();
  const client = useQueryClient();
  const { runs } = useDataset();
  const demoRun = useRunState();

  const runNow = useMutation({
    mutationFn: () => runNowFn({ data: {} }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: datasetQuery.queryKey });
      toast.success(
        result.executedInline
          ? `Ran ${result.endeavours} endeavour${result.endeavours === 1 ? "" : "s"}`
          : `Queued ${result.endeavours} endeavour${result.endeavours === 1 ? "" : "s"} for the worker`,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const latest = runs[0];
  const running =
    mode === "live"
      ? runs.some((r) => r.state === "RUNNING")
      : demoRun.phase !== "IDLE" && demoRun.phase !== "DONE";
  const busy = runNow.isPending || running;

  const banner =
    mode === "live"
      ? latest && (running || latest.state !== "OK")
        ? {
            tone: latest.state === "FAILED" ? ("error" as const) : ("ok" as const),
            text:
              latest.state === "FAILED"
                ? `RUN FAILED AT ${(PHASE_LABELS[latest.phase] ?? latest.phase).toUpperCase()}`
                : (PHASE_LABELS[latest.phase] ?? latest.phase),
            dismissible: false,
          }
        : null
      : demoRun.phase !== "IDLE"
        ? {
            tone: "ok" as const,
            text: demoRun.phase === "DONE" ? (demoRun.note ?? "") : demoRun.phase,
            dismissible: true,
          }
        : null;

  return (
    <>
      <Button
        variant="primary"
        size="md"
        className="h-9 rounded-full px-4"
        disabled={busy}
        onClick={() => (mode === "live" ? runNow.mutate() : startRun())}
        title="Run the daily loop now: review outstanding work, recalculate the pipeline and prepare today's queue, instead of waiting for the scheduled run."
      >
        {busy ? "RUNNING…" : "RUN NOW"}
      </Button>

      {banner && (
        <div className="fixed inset-x-3 top-[62px] z-40 flex justify-end md:left-[92px] md:right-5 md:top-[72px]">
          <div
            className="island-ink rise flex max-w-full items-center gap-3 rounded-full px-4 py-2"
            data-testid="run-banner"
          >
            <StatusDot tone={banner.tone} live={running} />
            <span className="machine text-ink-foreground/45">EXECUTION LOOP</span>
            <span className="machine text-ink-foreground">{banner.text}</span>
            {banner.dismissible && (
              <button
                type="button"
                onClick={dismissRun}
                className="machine text-ink-foreground/50 hover:text-ink-foreground"
              >
                DISMISS
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
