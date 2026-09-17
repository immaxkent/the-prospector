/** Live-mode read of every screen's records. */
import { createServerFn } from "@tanstack/react-start";
import { requireSession } from "./session";

export const fetchDataset = createServerFn({ method: "GET" })
  .middleware([requireSession])
  .handler(async () => {
    const [{ getConfig }, { getDb }, { loadDataset }] = await Promise.all([
      import("../server/config"),
      import("../server/db/client"),
      import("../server/read/dataset"),
    ]);
    const config = getConfig();
    if (config.mode !== "live") throw new Error("dataset is only served in live mode");
    return loadDataset(getDb(), { model: config.model, provider: "ANTHROPIC" });
  });
