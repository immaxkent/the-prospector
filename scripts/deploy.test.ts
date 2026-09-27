/**
 * The deploy script is not run in CI, so what it says is all we can check. These are the
 * mistakes that have actually broken a deploy before, kept from coming back.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("./deploy.sh", import.meta.url), "utf8");
const lines = script.split("\n");

describe("deploy.sh", () => {
  it("passes --env-file to every compose call", () => {
    // `env_file:` inside the compose file does not satisfy ${VAR} interpolation, so a
    // compose call without --env-file silently starts the stack with empty values.
    const compose = lines.filter((l) => l.includes("docker compose") && !l.trimStart().startsWith("#"));
    expect(compose.length).toBeGreaterThan(0);
    for (const line of compose) expect(line).toContain("--env-file .env.production");
  });

  it("keeps the running image before the new one overwrites the tag", () => {
    const keep = script.indexOf("prospector:previous");
    const load = script.indexOf("docker load");
    expect(keep).toBeGreaterThan(-1);
    expect(keep).toBeLessThan(load);
  });

  it("rolls back and fails when the new image never reports healthy", () => {
    expect(script).toContain("docker tag prospector:previous");
    const rollback = script.indexOf("rolling back");
    expect(script.slice(rollback)).toMatch(/exit 1/);
  });

  it("retries the health check rather than rolling back on the first miss", () => {
    expect(script).toMatch(/for attempt in/);
  });

  it("refuses to deploy an uncommitted tree", () => {
    expect(script).toContain("git status --porcelain");
    expect(script).toContain("refusing to deploy with uncommitted changes");
  });

  it("stamps a version that rises with every commit", () => {
    expect(script).toContain('VERSION="0.1.$(git rev-list --count HEAD)"');
  });
});
