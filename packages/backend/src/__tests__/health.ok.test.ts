import { describe, expect, it } from "vitest";
import { app } from "../app.js";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
