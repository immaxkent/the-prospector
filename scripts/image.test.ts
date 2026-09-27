/**
 * What the runtime image must contain for the worker to start.
 *
 * The worker runs `tsx src/worker.ts` against the raw sources rather than the bundle, so
 * it needs everything tsx needs at run time — including tsconfig.json, which is where the
 * `@/*` alias is defined. When that file was missing the worker crashlooped from its first
 * deploy while the web container beside it reported healthy, so nothing ever ran and
 * nothing ever said so.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));

const copies = (path: string) =>
  new RegExp(`^COPY --from=build /app/${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m").test(runtime);

describe("the runtime image", () => {
  it("carries the sources the worker executes", () => {
    for (const path of ["src", "scripts", "db", "package.json", "node_modules"]) {
      expect(copies(path), `runtime stage does not copy ${path}`).toBe(true);
    }
  });

  it("carries tsconfig.json, which is where tsx reads the @/ alias from", () => {
    expect(copies("tsconfig.json")).toBe(true);
  });

  it("copies a config for every alias the worker's sources actually use", () => {
    // If a second tsconfig is ever introduced, this fails rather than letting the worker
    // resolve half its imports.
    const paths = JSON.parse(
      readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""),
    ).compilerOptions?.paths;
    expect(paths).toEqual({ "@/*": ["./src/*"] });
  });

  it("serves the app from the built output, not from tsx", () => {
    // tsx is for the worker and the migration script; the web process runs the bundle.
    expect(runtime).toContain('CMD ["node", ".output/server/index.mjs"]');
  });
});
