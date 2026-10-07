import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useDataset } from "@/data/store";
import { prospectDecision } from "@/data/prospect-state";
import { EmptyState, MachineLabel, Meter, Panel, Tag } from "@/components/os/primitives";
import { ContactRoutes } from "@/components/os/ContactRoutes";
import { Timeline } from "@/components/os/Timeline";
import { ProspectActions } from "@/components/os/ProspectActions";
import { LogInteraction } from "@/components/os/LogInteraction";
import { ReachTag } from "@/components/os/ReachTag";
import { gbp, scoreText, stamp } from "@/lib/format";

export const Route = createFileRoute("/prospects/$id")({
  head: () => ({
    meta: [
      { title: "Prospect — CBO OS" },
      {
        name: "description",
        content:
          "One prospect: who they are, how they can be reached, and everything that has happened.",
      },
    ],
  }),
  component: ProspectScreen,
});

/**
 * One prospect, on one screen.
 *
 * What was known about a company used to be spread across the prospects inspector, the
 * mailbox, the interaction log and the evidence table. Holding four screens in your head is
 * not a decision process, so in practice the decision was made on the score alone.
 *
 * The order is the order the questions get asked: can they be reached, why does the agent
 * think this is worth doing, what has already happened, and what do you want to do about it.
 */
function ProspectScreen() {
  const { id } = Route.useParams();
  const { prospects, endeavours } = useDataset();
  const prospect = prospects.find((p) => p.id === id);

  if (!prospect) {
    return (
      <EmptyState
        title="NO SUCH PROSPECT"
        body="It may have been deleted with its endeavour, or the link is from another install."
      />
    );
  }

  const decision = prospectDecision(prospect);
  const endeavour = endeavours.find((e) => e.id === prospect.endeavourId);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/prospects" className="machine text-muted-foreground hover:text-foreground">
          ← PROSPECTS
        </Link>
        <h1 className="display mt-2 text-[28px] font-medium">{prospect.person}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {prospect.role ? `${prospect.role} · ` : ""}
          {prospect.companyName}
          {prospect.companyDomain ? ` · ${prospect.companyDomain}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Tag tone={decision.needsDecision ? "signal" : "neutral"}>{decision.reason}</Tag>
          <ReachTag contacts={prospect.contacts} />
          <MachineLabel>
            {prospect.score === null ? "NOT SCORED YET" : `SCORE ${scoreText(prospect.score)}`} ·{" "}
            {prospect.stage}
            {prospect.segment ? ` · ${prospect.segment}` : ""}
            {endeavour ? ` · ${endeavour.name}` : ""}
            {prospect.companyTimezone ? ` · ${prospect.companyTimezone}` : ""}
          </MachineLabel>
        </div>
      </div>

      <Section title="HOW THEY CAN BE REACHED">
        <ContactRoutes
          routes={prospect.routes}
          companyId={prospect.companyId}
          companyName={prospect.companyName}
        />
      </Section>

      <Section title="WHY THE AGENT THINKS SO">
        {prospect.trigger && <p className="text-[14px]">{prospect.trigger}</p>}
        {prospect.scoreReason && (
          <p className="mt-1 text-[13px] text-muted-foreground">{prospect.scoreReason}</p>
        )}
        {prospect.scoreFactors.length > 0 ? (
          <div className="mt-3 space-y-2">
            {prospect.scoreFactors.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between">
                  <span className="machine">{f.label}</span>
                  <span className="numeral text-[12px]">+{f.weight}</span>
                </div>
                <div className="mt-1">
                  <Meter value={f.weight / 40} />
                </div>
                <p className="machine mt-1 normal-case tracking-normal">{f.note}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="machine mt-2">NOTHING SCORED YET</p>
        )}
      </Section>

      <Section title="WHAT HAS HAPPENED">
        <Timeline entries={prospect.timeline} />
      </Section>

      <Section title="CONTACT THAT DID NOT GO THROUGH THE MAILBOX">
        <LogInteraction prospectId={prospect.id} />
      </Section>

      <Section title="WHAT YOU WANT TO DO">
        {prospect.nextAction && <p className="mb-3 text-[14px]">{prospect.nextAction}</p>}
        {prospect.opportunityValue !== null && (
          <p className="machine mb-3">ESTIMATED OPPORTUNITY {gbp(prospect.opportunityValue)}</p>
        )}
        <ProspectActions prospect={prospect} />
        {prospect.releasedAt && (
          <p className="machine mt-3">RELEASED {stamp(prospect.releasedAt)}</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <MachineLabel tone="signal">{title}</MachineLabel>
      <div className="mt-2">{children}</div>
    </Panel>
  );
}
