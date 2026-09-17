import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { importProspectsFn } from "@/api/mutations";
import { errorMessage } from "@/data/mutations";
import { datasetQuery } from "@/data/queries";
import { useAppMode, useDataset } from "@/data/store";
import { Button, MachineLabel } from "./primitives";

const inputCls =
  "w-full rounded-[3px] border border-border bg-card px-2.5 py-2 text-[13px] outline-none focus:border-signal";

/** Import a CSV of prospects into an endeavour, and download what is already stored. */
export function ImportPanel() {
  const mode = useAppMode();
  const client = useQueryClient();
  const { endeavours } = useDataset();
  const [endeavourId, setEndeavourId] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: (data: { endeavourId: string; csv: string }) => importProspectsFn({ data }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: datasetQuery.queryKey });
      toast.success(
        `Imported ${result.imported} · ${result.duplicates} already known · ${result.suppressed} suppressed`,
      );
      setCsv("");
      setFileName(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const target = endeavourId || endeavours[0]?.id || "";

  return (
    <div className="space-y-3 px-4 py-4" data-testid="import-panel">
      <p className="text-[13px] text-muted-foreground">
        A CSV with a header row. Columns: company (required), domain, person, role, email,
        linkedinUrl, trigger, note, source. Imported prospects go through the same do-not-contact
        and duplicate checks as researched ones.
      </p>

      <label className="block space-y-1.5">
        <MachineLabel>ENDEAVOUR</MachineLabel>
        <select
          aria-label="Import into"
          className={inputCls}
          value={target}
          onChange={(e) => setEndeavourId(e.target.value)}
        >
          {endeavours.length === 0 && <option value="">No endeavour yet</option>}
          {endeavours.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <MachineLabel>CSV FILE</MachineLabel>
        <input
          aria-label="CSV file"
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-[12px]"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setCsv(await file.text());
          }}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={load.isPending || !csv.trim() || !target}
          onClick={() => {
            if (mode === "demo") {
              toast("Demo mode: nothing was imported");
              return;
            }
            load.mutate({ endeavourId: target, csv });
          }}
        >
          {load.isPending ? "Importing…" : "Import records"}
        </Button>
        {fileName && <MachineLabel>{fileName}</MachineLabel>}
      </div>
    </div>
  );
}
