import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WALKTHROUGHS, walkthroughById } from "@/data/walkthroughs";
import { MachineLabel, PageHeader, Panel } from "@/components/os/primitives";

export const Route = createFileRoute("/walkthroughs")({
  validateSearch: (search: Record<string, unknown>) => ({
    open: typeof search["open"] === "string" ? search["open"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Walkthroughs — CBO OS" },
      { name: "description", content: "Step-by-step setup for the things that have to be done outside this app." },
      { property: "og:title", content: "Walkthroughs — CBO OS" },
      { property: "og:description", content: "Connecting Slack, Telegram, and sending from an alias." },
    ],
  }),
  component: WalkthroughsScreen,
});

function WalkthroughsScreen() {
  const { open } = Route.useSearch();
  const navigate = useNavigate();
  const chosen = open ? walkthroughById(open) : undefined;
  const shown = chosen ? [chosen] : WALKTHROUGHS;

  return (
    <div className="space-y-5">
      <PageHeader
        title="WALKTHROUGHS"
        summary="Some things have to be done in Google or Slack rather than here. These are the steps, in order, with the links."
      />

      {chosen && (
        <button
          type="button"
          className="machine text-muted-foreground hover:text-signal"
          onClick={() => navigate({ to: "/walkthroughs", search: { open: undefined } })}
        >
          ← ALL WALKTHROUGHS
        </button>
      )}

      {shown.map((walkthrough) => (
        <Panel
          key={walkthrough.id}
          title={walkthrough.title.toUpperCase()}
          meta={<MachineLabel>{walkthrough.takes.toUpperCase()}</MachineLabel>}
          bodyClassName="space-y-3 px-4 py-4"
        >
          <p className="text-[13px] text-muted-foreground">{walkthrough.why}</p>

          <ol className="space-y-2" data-testid={`walkthrough-${walkthrough.id}`}>
            {walkthrough.steps.map((step, index) => (
              <li key={index} className="flex gap-3 text-[13px]">
                <span className="machine mt-0.5 shrink-0 text-signal">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  {step.text}
                  {step.link && (
                    <>
                      {" "}
                      <a
                        href={step.link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-signal underline decoration-dotted underline-offset-2 hover:decoration-solid"
                      >
                        {step.link.label} ↗
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>

          <div className="rounded-[3px] border border-border px-3 py-2">
            <MachineLabel>YOU ARE DONE WHEN</MachineLabel>
            <p className="mt-1 text-[13px]">{walkthrough.done}</p>
          </div>
        </Panel>
      ))}
    </div>
  );
}
