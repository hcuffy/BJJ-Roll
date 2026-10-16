import { describe, expect, it } from "vitest";
import { formatGreeting } from "../index.js";

describe("formatGreeting", () => {
  it("greets by name", () => {
    expect(formatGreeting("BJJ-Roll")).toBe("Hello, BJJ-Roll!");
  });
});
