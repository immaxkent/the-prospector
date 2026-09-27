/**
 * The deploy workflow cannot be run locally, and a mistake in it is only discovered by a
 * merge to main going wrong. These pin the parts that decide whether a deploy happens at
 * all, and the parts that decide whether it is safe.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const deploy = workflow.slice(workflow.indexOf("  deploy:"));

describe("the deploy job", () => {
  it("waits for the checks", () => {
    expect(deploy).toContain("needs: check");
  });

  it("only runs for a push to main", () => {
    // pull_request also triggers this workflow; a proposed change must not reach the box.
    expect(deploy).toContain("if: github.ref == 'refs/heads/main' && github.event_name == 'push'");
  });

  it("lets a running deploy finish rather than cancelling it half-applied", () => {
    expect(deploy).toContain("group: deploy-production");
    expect(deploy).toContain("cancel-in-progress: false");
  });

  it("checks out the whole history, because the version counts commits", () => {
    expect(deploy).toContain("fetch-depth: 0");
  });

  it("names the missing secret instead of failing inside ssh", () => {
    expect(deploy).toContain("main was not deployed: set these repository secrets:");
    for (const secret of ["DEPLOY_SSH_KEY", "DEPLOY_HOST", "APP_DOMAIN"]) {
      expect(deploy).toContain(`$missing ${secret}`);
    }
    // The guard has to come before anything that uses them.
    expect(deploy.indexOf("main was not deployed")).toBeLessThan(deploy.indexOf("ssh-keyscan"));
  });

  it("reads every secret through the environment, never into a shell body", () => {
    // A secret interpolated into `run:` is substituted before the shell sees it, so its
    // contents become script. Passing it through `env:` keeps it a value.
    const runBodies = deploy.split(/\n      - /).flatMap((step) => {
      const at = step.indexOf("\n        run:");
      return at === -1 ? [] : [step.slice(at)];
    });
    expect(runBodies.length).toBeGreaterThan(0);
    for (const body of runBodies) expect(body).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it("asks the public URL whether the deploy is really up", () => {
    // deploy.sh already checked from inside the container; this is the path a visitor takes.
    expect(deploy).toContain('curl -fsS --max-time 30 "https://$DOMAIN/healthz"');
  });
});
