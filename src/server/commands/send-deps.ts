/** Builds the sending dependencies from config, or none when Google or the key is missing. */
import type { AppConfig } from "../config";
import type { SendDeps } from "./send";

export function createSendDeps(config: AppConfig): SendDeps | null {
  if (!config.google || !config.tokenKey) return null;
  return { clientId: config.google.clientId, clientSecret: config.google.clientSecret, tokenKey: config.tokenKey };
}
