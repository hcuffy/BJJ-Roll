/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readBackendUrl } from "../auth/authConfig";

describe("readBackendUrl", () => {
  it("reads the backend URL from Expo config extra", () => {
    expect(readBackendUrl({ extra: { backendUrl: "http://10.0.2.2:3000" } })).toBe("http://10.0.2.2:3000");
  });

  it("throws when the backend URL is missing or not http(s)", () => {
    expect(() => readBackendUrl(null)).toThrow("backendUrl");
    expect(() => readBackendUrl({ extra: {} })).toThrow("backendUrl");
    expect(() => readBackendUrl({ extra: { backendUrl: "bjjroll://auth" } })).toThrow("backendUrl");
  });

  it("app.json has the bjjroll scheme and a dev backend URL", () => {
    const appJson = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8")) as {
      expo: { scheme: string; extra?: { backendUrl?: string } };
    };
    expect(appJson.expo.scheme).toBe("bjjroll");
    expect(readBackendUrl(appJson.expo)).toMatch(/^http:\/\//u);
  });
});
