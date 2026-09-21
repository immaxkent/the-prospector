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
  updateMailboxLimitsFn,
  updateSettingsFn,
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
      : `${out.alias.address} was created, but Gmail has not accepted it yet`,
  );
export const useUpdateEndeavourSettings = () => useAction(updateEndeavourSettingsFn, "Configuration saved");
export const useUpdateSettings = () =>
  useAction(updateSettingsFn, (input) => `Model ${input.model} · £${(input.monthlyBudgetPence / 100).toFixed(2)} a month`);
export const useSetEndeavourFromAlias = () =>
  useAction(setEndeavourFromAliasFn, (input) =>
    input.alias ? `Sending as ${input.alias}` : "Sending as the mailbox's own address",
  );
