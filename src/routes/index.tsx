import { createFileRoute, Link } from "@tanstack/react-router";
import { useDataset } from "@/data/store";
import { MachineLabel, StatusDot, Tag } from "@/components/os/primitives";
import { num } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Prospector — CBO Operating System" },
      {
        name: "description",
        content: "Prospector is the Chief Business Officer operating system for commercial command and conversations.",
      },
      { property: "og:title", content: "Prospector — CBO Operating System" },
      {
        property: "og:description",
        content: "Enter Command or Inbox from the Prospector operating system.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomeScreen,
});

function HomeScreen() {
  const { status, threads, approvals, isEmpty } = useDataset();

  return (
    <div className="flex min-h-[calc(100vh-104px)] items-center justify-center pb-12">
      <section className="relative flex w-full max-w-[1040px] flex-col items-center px-4 text-center">

        <div className="relative z-10">
          <div className="mb-5 flex items-center justify-center gap-2">
            <StatusDot tone={status.agent === "ERROR" ? "error" : "ok"} live />
            <MachineLabel tone="signal">SYSTEM {status.agent}</MachineLabel>
          </div>
          <h1
            className="prospector-title display text-[clamp(58px,11vw,156px)] font-black leading-[0.78]"
            data-text="PROSPECTOR"
          >
            PROSPECTOR
          </h1>
          <p className="machine mt-8 text-[10px] text-foreground/65 sm:text-[12px]">
            CHIEF BUSINESS OFFICER OPERATING SYSTEM
          </p>
        </div>

        <div className="relative z-10 mt-14 grid w-full max-w-[620px] grid-cols-1 gap-4 sm:grid-cols-2">
          <Link to="/command" className="home-action group">
            <span className="display text-[20px] font-semibold">Command</span>
            <span className="machine mt-2 text-ink-foreground/48">
              {num(approvals.length)} {approvals.length === 1 ? "DECISION" : "DECISIONS"} AWAITING
            </span>
            <span className="home-action-arrow" aria-hidden="true">↗</span>
          </Link>

          <Link to="/inbox" className="home-action group">
            <span className="display text-[20px] font-semibold">Inbox</span>
            <span className="machine mt-2 text-ink-foreground/48">
              {num(threads.length)} OPEN {threads.length === 1 ? "THREAD" : "THREADS"}
            </span>
            <span className="home-action-arrow" aria-hidden="true">↗</span>
          </Link>
        </div>

        {isEmpty && (
          <div className="relative z-10 mt-8">
            <Tag tone="warn">NO RECORDS — CLEAN INSTALL</Tag>
          </div>
        )}
      </section>
    </div>
  );
}