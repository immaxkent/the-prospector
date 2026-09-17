import { describe, expect, it } from "vitest";
import { parseCsv, rowToCandidate } from "./import";

describe("rowToCandidate", () => {
  it("keeps the importer's note as the evidence", () => {
    const candidate = rowToCandidate({
      company: "Havsledd Labs",
      domain: "havsledd.example",
      person: "Tomas",
      role: "Lead engineer",
      email: "tomas@havsledd.example",
      note: "Met at a conference in June",
      source: "conference list",
    });
    expect(candidate).toMatchObject({
      company: { name: "Havsledd Labs", domain: "havsledd.example" },
      person: { name: "Tomas", email: "tomas@havsledd.example" },
      trigger: { type: "import" },
    });
    expect(candidate.evidence[0]).toMatchObject({ claim: "Met at a conference in June", sourceRef: "conference list" });
  });

  it("works from a company alone, and says where the row came from", () => {
    const candidate = rowToCandidate({ company: "Anon Labs" });
    expect(candidate.person).toBeUndefined();
    expect(candidate.evidence[0]!.claim).toContain("Imported from a list");
  });
});

describe("parseCsv", () => {
  it("reads a header row and its records", () => {
    expect(parseCsv("company,email\nHavsledd,tomas@havsledd.example\n")).toEqual([
      { company: "Havsledd", email: "tomas@havsledd.example" },
    ]);
  });

  it("handles quoted commas, escaped quotes and newlines inside fields", () => {
    const csv = 'company,note\n"Havsledd, Labs","said ""yes"" in\nJune"\n';
    expect(parseCsv(csv)).toEqual([{ company: "Havsledd, Labs", note: 'said "yes" in\nJune' }]);
  });

  it("ignores blank lines and pads short rows", () => {
    expect(parseCsv("company,email\n\nHavsledd\n")).toEqual([{ company: "Havsledd", email: "" }]);
    expect(parseCsv("")).toEqual([]);
  });
});
