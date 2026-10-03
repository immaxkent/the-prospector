import { describe, expect, it } from "vitest";
import { ENDEAVOUR_SECTIONS, SECTION_IDS } from "./endeavour-sections";

describe("the endeavour's sections", () => {
  it("runs in the order the work happens, not the order of the data model", () => {
    // Research produced everything else and used not to be on the page at all.
    expect(SECTION_IDS).toEqual([
      "overview",
      "research",
      "identify",
      "reach",
      "outreach",
      "conversations",
      "deals",
      "strategy",
      "configuration",
      "runs",
    ]);
  });

  it("puts finding before deciding, and deciding before writing", () => {
    const at = (id: string) => SECTION_IDS.indexOf(id);
    expect(at("research")).toBeLessThan(at("identify"));
    expect(at("identify")).toBeLessThan(at("reach"));
    expect(at("reach")).toBeLessThan(at("outreach"));
    expect(at("outreach")).toBeLessThan(at("conversations"));
    expect(at("conversations")).toBeLessThan(at("deals"));
  });

  it("keeps the settings together at the end, after the work", () => {
    expect(SECTION_IDS.slice(-3)).toEqual(["strategy", "configuration", "runs"]);
  });

  it("says what an unbuilt stage will do, so the gap is legible rather than mysterious", () => {
    for (const section of ENDEAVOUR_SECTIONS) {
      if (section.built) continue;
      expect(section.what, `${section.id} is unbuilt and says nothing about itself`).toBeTruthy();
    }
  });

  it("has no duplicate ids, which would make an anchor ambiguous", () => {
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length);
  });
});
