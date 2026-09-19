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
    const { channelStatus } = await import("../server/notify/channels");
    const [{ hasAliasScopes }, { unsealJson }] = await Promise.all([
      import("../server/commands/mailboxes"),
      import("../server/crypto/tokens"),
    ]);
    const key = config.tokenKey;
    return loadDataset(getDb(), {
      model: config.model,
      provider: "ANTHROPIC",
      apiEnabled: config.apiKeys.length > 0,
      notifications: channelStatus(config),
      aliasConsent: (ciphertext) => {
        if (!key) return false;
        try {
          return hasAliasScopes(unsealJson<{ scope: string }>(ciphertext, key).scope);
        } catch {
          // A token we cannot read is one we cannot claim consent for.
          return false;
        }
      },
    });
  });
