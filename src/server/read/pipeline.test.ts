import { describe, expect, it } from "vitest";
import { buildOpportunity } from "./pipeline";
import { companyRow, opportunityRow, prospectRow } from "./testing";

describe("buildOpportunity", () => {
  const prospects = new Map([["pro_1", prospectRow({ nextAction: "Send proposal" })]]);
  const companies = new Map([["com_1", companyRow()]]);

  it("joins company and next action and falls back to the stage probability", () => {
    expect(buildOpportunity(opportunityRow(), prospects, companies)).toMatchObject({
      company: "Northbridge",
      probability: 0.6,
      nextAction: "Send proposal",
    });
  });

  it("prefers the user's probability", () => {
    expect(buildOpportunity(opportunityRow({ probabilityUserDefined: 0.9 }), prospects, companies).probability).toBe(0.9);
    expect(buildOpportunity(opportunityRow({ prospectId: null }), prospects, companies).company).toBe("—");
  });
});
