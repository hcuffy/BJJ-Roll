import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMs } from "../dates";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("mobile date boundary", () => {
  it.each(["UTC", "Europe/Berlin", "America/New_York"])("reads the same instant around the DST change in %s", (zone) => {
    vi.stubEnv("TZ", zone);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_792_890_000_000);
    expect(currentMs()).toBe(1_792_890_000_000);
    vi.advanceTimersByTime(3_600_000);
    expect(currentMs()).toBe(1_792_893_600_000);
  });
});
