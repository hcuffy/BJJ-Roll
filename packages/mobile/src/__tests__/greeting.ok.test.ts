import { describe, expect, it } from "vitest";
import { greetingText } from "../greeting";

describe("greetingText", () => {
  it("says hello", () => {
    expect(greetingText).toBe("Hello from BJJ Roll");
  });
});
