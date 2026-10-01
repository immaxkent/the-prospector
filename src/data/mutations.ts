/**
 * Operator actions for the screens. Each hook calls its server function, refreshes the dataset,
 * and reports the outcome in a toast. Failures keep the screen unchanged.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  assignEndeavourMailboxFn,
  createMailboxAliasFn,
  decideApprovalFn,
  disconnectMailboxFn,
  markThreadReadFn,
  moveProspectStageFn,
  rejectProspectFn,
  restoreProspectFn,
  setEndeavourFromAliasFn,
  setEndeavourStatusFn,
  suppressProspectFn,
  updateEndeavourSettingsFn,
  pinSegmentShareFn,
  logInteractionFn,
  resolveProspectsFn,
  updateMailboxLimitsFn,
  updateSettingsFn,
  purgeEndeavourFn,
  releaseProspectsFn,
  holdProspectFn,
  addCompanyContactFn,
  updateStatTilesFn,
  updateOpportunityFn,
} from "@/api/mutations";
import { datasetQuery } from "./queries";

type ServerFn<I, O> = (opts: { data: I }) => Promise<O>;

export function errorMessage(err: unknown) {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Nothing was changed.";
}

function useAction<I, O>(fn: ServerFn<I, O>, success: string | ((input: I, output: O) => string) | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: I) => fn({ data }),
    onSuccess: async (output, input) => {
      await client.invalidateQueries({ queryKey: datasetQuery.queryKey });
      if (success) toast.success(typeof success === "function" ? success(input, output) : success);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });
}

export const useDecideApproval = () =>
  useAction(decideApprovalFn, (input) =>
    input.decision === "approve" ? (input.editedCopy ? "Approved with your edits" : "Approved") : "Rejected",
  );
export const useRejectProspect = () => useAction(rejectProspectFn, "Prospect rejected");
export const useRestoreProspect = () => useAction(restoreProspectFn, "Prospect restored for review");
export const useSuppressProspect = () =>
  useAction(suppressProspectFn, (_i, out) => `Suppressed ${out.kind} ${out.value}`);
export const useMoveProspectStage = () => useAction(moveProspectStageFn, (input) => `Moved to ${input.to}`);
export const useUpdateOpportunity = () => useAction(updateOpportunityFn, "Opportunity updated");
export const useSetEndeavourStatus = () =>
  useAction(setEndeavourStatusFn, (input) =>
    input.status === "active" ? "Endeavour resumed" : input.status === "paused" ? "Endeavour paused" : "Endeavour archived",
  );
export const useMarkThreadRead = () => useAction(markThreadReadFn, null);
export const useUpdateMailboxLimits = () => useAction(updateMailboxLimitsFn, "Mailbox limits saved");
export const useDisconnectMailbox = () => useAction(disconnectMailboxFn, "Mailbox disconnected");
export const useAssignEndeavourMailbox = () => useAction(assignEndeavourMailboxFn, "Sending mailbox changed");
export const useCreateMailboxAlias = () =>
  useAction(createMailboxAliasFn, (_i, out) =>
    out.sendAsReady
      ? `${out.alias.address} is ready to send from`
      : // Gmail refuses to register a send-as from an ordinary token, so this is a step the
        // operator has to take themselves. Saying where beats saying it did not work.
        `${out.alias.address} exists — Gmail needs you to add it as a send-as. See Walkthroughs.`,
  );
export const useUpdateEndeavourSettings = () => useAction(updateEndeavourSettingsFn, "Configuration saved");
export const useResolveProspects = () =>
  useAction(resolveProspectsFn, (input, output) => {
    const done = (output as { resolved: string[]; refused: { id: string }[] }).resolved.length;
    const refused = (output as { refused: { id: string }[] }).refused.length;
    const verb = { dequeue: "dequeued", reject: "rejected", won: "marked won", lost: "marked lost" }[input.resolution];
    return refused ? `${done} ${verb}, ${refused} could not be` : `${done} ${verb}`;
  });
export const useLogInteraction = () =>
  useAction(logInteractionFn, (input) =>
    input.direction === "inbound" ? "Recorded: they answered" : "Recorded: you reached out",
  );
export const usePinSegmentShare = () =>
  useAction(pinSegmentShareFn, (input) =>
    input.share === null ? "Back to the equal split" : `Pinned at ${input.share}`,
  );
export const useUpdateSettings = () =>
  useAction(updateSettingsFn, (input) => `Model ${input.model} · £${(input.monthlyBudgetPence / 100).toFixed(2)} a month`);
export const usePurgeEndeavour = () =>
  useAction(purgeEndeavourFn, (input) => `Deleted ${input.confirmName} and everything under it`);
export const useReleaseProspects = () =>
  useAction(releaseProspectsFn, (input) => `${input.prospectIds.length} prospect(s) released for outreach`);
export const useHoldProspect = () => useAction(holdProspectFn, "Held: nothing will be drafted for this one");
export const useAddCompanyContact = () => useAction(addCompanyContactFn, (input) => `Added ${input.value}`);
export const useUpdateStatTiles = () => useAction(updateStatTilesFn, "Headline numbers updated");
export const useSetEndeavourFromAlias = () =>
  useAction(setEndeavourFromAliasFn, (input) =>
    input.alias ? `Sending as ${input.alias}` : "Sending as the mailbox's own address",
  );
