/**
 * What is actually running.
 *
 * The values are baked in at image build time, so a page can say which deploy it came from
 * without anyone asking the server. Outside a release build they read "dev", which is the
 * honest answer rather than a version number that means nothing.
 */
const raw = {
  version: import.meta.env["VITE_APP_VERSION"],
  commit: import.meta.env["VITE_APP_COMMIT"],
  builtAt: import.meta.env["VITE_APP_BUILT_AT"],
};

export const BUILD_INFO = {
  version: raw.version || "dev",
  commit: raw.commit || "local",
  /** ISO timestamp of the build, or empty when this is not a release build. */
  builtAt: raw.builtAt || "",
} as const;

/** "0.1.42 · 74ef691 · built 2026-09-22 21:30 UTC", or the dev equivalent. */
export function buildLine(info: { version: string; commit: string; builtAt: string } = BUILD_INFO) {
  const when = info.builtAt ? ` · built ${info.builtAt.replace("T", " ").slice(0, 16)} UTC` : "";
  return `${info.version} · ${info.commit}${when}`;
}
