import { describe, expect, it } from "vitest";
import { errorMessage } from "./mutations";

describe("errorMessage", () => {
  it("shows the server's message and a safe fallback otherwise", () => {
    expect(errorMessage(new Error("approval was already approved"))).toBe("approval was already approved");
    expect(errorMessage(new Error(""))).toBe("Something went wrong. Nothing was changed.");
    expect(errorMessage("nope")).toBe("Something went wrong. Nothing was changed.");
  });
});
