import { createFileRoute, Link } from "@tanstack/react-router";
import { useDataset } from "@/data/store";
import {
  Button,
  EmptyState,
  LedgerTable,
  Meter,
  PageHeader,
  Panel,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/os/primitives";
import { gbp, num, shortDate, stamp, daysUntil } from "@/lib/format";

export const Route = createFileRoute("/endeavours/")({
  head: () => ({
    meta: [
      { title: "Endeavours — CBO OS" },
      {
        name: "description",
        content: "Ledger of commercial endeavours: objective, horizon, progress, pipeline, quota and agent run state.",
      },
      { property: "og:title", content: "Endeavours — CBO OS" },
      { property: "og:description", content: "Every commercial objective tracked as a disciplined ledger row." },
    ],
  }),
  component: EndeavoursScreen,
});

function EndeavoursScreen() {
  const { endeavours, isEmpty } = useDataset();

  return (
    <div className="space-y-5">
      <PageHeader
        title="ENDEAVOURS"
        summary="Each row is a measurable commercial outcome with its own research queue, cadence and execution loop."
        actions={
          <Link to="/endeavours/new">
            <Button variant="primary">New endeavour</Button>
          </Link>
        }
      />

      {isEmpty ? (
        <EmptyState
          title="NO ACTIVE ENDEAVOURS"
          body="Define a commercial outcome. CBO OS will build the target model, research queue, outreach cadence and daily execution loop around it."
          action={
            <Link to="/endeavours/new">
              <Button variant="primary">Create first endeavour</Button>
            </Link>
          }
        />
      ) : (
        <Panel>
          <LedgerTable>
            <thead>
              <tr>
                <Th>Endeavour</Th>
                <Th>Objective</Th>
                <Th align="right">Horizon</Th>
                <Th align="right">Progress</Th>
                <Th align="right">Pipeline</Th>
                <Th align="right">Quota</Th>
                <Th>Health</Th>
                <Th align="right">Last run</Th>
              </tr>
            </thead>
            <tbody>
              {endeavours.map((e) => {
                const quotaDone = e.quotaDone.outreach + e.quotaDone.followups + e.quotaDone.newProspects;
                const quotaTotal = e.quota.outreach + e.quota.followups + e.quota.newProspects;
                return (
                  <Tr key={e.id}>
                    <Td>
                      <Link to="/endeavours/$id" params={{ id: e.id }} className="hover:text-signal">
                        <span className="text-[13px] font-medium">{e.name}</span>
                      </Link>
                    </Td>
                    <Td className="max-w-[280px]">
                      <span className="text-[13px] text-muted-foreground">{e.objective}</span>
                    </Td>
                    <Td align="right" mono>
                      {daysUntil(e.deadline)}d
                      <div className="machine">{shortDate(e.deadline)}</div>
                    </Td>
                    <Td align="right" className="min-w-[160px]">
                      <div className="numeral text-[13px]">
                        {e.unit === "GBP" ? gbp(e.actualValue) : num(e.actualValue)}
                        <span className="text-muted-foreground">
                          {" / "}
                          {e.unit === "GBP" ? gbp(e.targetValue) : num(e.targetValue)}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Meter
                          value={e.actualValue / e.targetValue}
                          tone={e.health === "BEHIND" ? "danger" : e.health === "AT_RISK" ? "warn" : "signal"}
                        />
                      </div>
                    </Td>
                    <Td align="right" mono>
                      {e.unit === "GBP" ? gbp(e.pipelineValue) : num(e.pipelineValue)}
                    </Td>
                    <Td align="right" mono>
                      {quotaDone}/{quotaTotal}
                    </Td>
                    <Td>
                      <Tag tone={e.health === "ON_TRACK" ? "signal" : e.health === "AT_RISK" ? "warn" : "danger"}>
                        {e.health.replace("_", " ")}
                      </Tag>
                    </Td>
                    <Td align="right" mono className="text-muted-foreground">
                      {stamp(e.lastRunAt)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </LedgerTable>
        </Panel>
      )}
    </div>
  );
}
