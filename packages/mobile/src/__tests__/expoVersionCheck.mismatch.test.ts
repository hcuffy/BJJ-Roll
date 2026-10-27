import { describe, expect, it } from "vitest";
import { checkExpoVersionReport } from "../../scripts/expoVersionCheck";

function reportWith(dependencies: { packageName: string; expectedVersionOrRange: string; actualVersion: string }[]): string {
  return JSON.stringify({ dependencies: dependencies.map((dependency) => ({ packageType: "dependencies", ...dependency })), upToDate: false });
}

describe("checkExpoVersionReport", () => {
  it("passes when every package matches the Expo SDK", () => {
    const result = checkExpoVersionReport(JSON.stringify({ dependencies: [], upToDate: true }));

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  it("fails on a minor version mismatch", () => {
    const result = checkExpoVersionReport(
      reportWith([{ packageName: "react-native-safe-area-context", expectedVersionOrRange: "~5.7.0", actualVersion: "5.6.2" }]),
    );

    expect(result.ok).toBe(false);
    expect(result.blocking.map((mismatch) => mismatch.packageName)).toEqual(["react-native-safe-area-context"]);
  });

  it("fails on a major version mismatch", () => {
    const result = checkExpoVersionReport(
      reportWith([{ packageName: "expo-constants", expectedVersionOrRange: "~57.0.22", actualVersion: "56.0.9" }]),
    );

    expect(result.ok).toBe(false);
  });

  it("passes on patch drift only and lists it as a warning", () => {
    const result = checkExpoVersionReport(
      reportWith([
        { packageName: "expo", expectedVersionOrRange: "~57.0.31", actualVersion: "57.0.27" },
        { packageName: "expo-network", expectedVersionOrRange: "~57.0.3", actualVersion: "57.0.2" },
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.patchDrift.map((mismatch) => mismatch.packageName)).toEqual(["expo", "expo-network"]);
  });

  it("fails on a prerelease or unreadable version", () => {
    const result = checkExpoVersionReport(
      reportWith([{ packageName: "expo", expectedVersionOrRange: "~57.0.31", actualVersion: "57.0.0-canary-20260718" }]),
    );

    expect(result.ok).toBe(false);
  });

  it("fails when the report is not JSON", () => {
    expect(checkExpoVersionReport("CommandError: something went wrong").ok).toBe(false);
  });

  it("fails when the report says out of date but lists nothing", () => {
    expect(checkExpoVersionReport(JSON.stringify({ dependencies: [], upToDate: false })).ok).toBe(false);
  });
});
