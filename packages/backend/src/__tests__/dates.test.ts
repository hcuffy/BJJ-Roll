import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDate, currentMs, currentSeconds, secondsAfter, toDate, toIsoString, toMs } from "../dates.js";

const originalZone = process.env.TZ;
const zones = ["UTC", "Europe/Berlin", "America/New_York"];
const inputs = ["2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00+02:00", "2026-10-25T02:30:00", "2026-10-31", "2026-03-29 02:30:00.123456"];

function inZone<T>(zone: string, read: () => T): T {
  process.env.TZ = zone;
  return read();
}

afterEach(() => {
  process.env.TZ = originalZone;
  vi.useRealTimers();
});

describe("backend date boundary", () => {
  it.each(zones)("parses strings exactly like the native Date in %s", (zone) => {
    for (const input of inputs) {
      inZone(zone, () => {
        expect(toMs(input)).toBe(new Date(input).getTime());
        expect(toIsoString(input)).toBe(new Date(input).toISOString());
        expect(toDate(input).getTime()).toBe(new Date(input).getTime());
      });
    }
  });

  it("gives the same instant for zoned input in UTC and local time", () => {
    const readings = zones.map((zone) => inZone(zone, () => [toMs("2026-10-25T02:30:00+02:00"), toIsoString(1_792_888_200_000)]));
    expect(new Set(readings.map((reading) => reading.join("|"))).size).toBe(1);
    expect(readings[0]).toEqual([1_792_888_200_000, "2026-10-25T00:30:00.000Z"]);
  });

  it.each(zones)("adds exact seconds across the autumn and spring DST changes in %s", (zone) => {
    inZone(zone, () => {
      expect(toIsoString(secondsAfter("2026-10-25T00:30:00.000Z", 3600))).toBe("2026-10-25T01:30:00.000Z");
      expect(toIsoString(secondsAfter("2026-03-29T00:30:00.000Z", 3600))).toBe("2026-03-29T01:30:00.000Z");
      expect(toMs(secondsAfter(new Date(1_000), 86_400))).toBe(86_401_000);
    });
  });

  it("formats a Date and a millisecond count the same as toISOString", () => {
    const instant = new Date("2026-10-25T01:59:59.999Z");
    expect(toIsoString(instant)).toBe(instant.toISOString());
    expect(toIsoString(instant.getTime())).toBe(instant.toISOString());
    expect(toDate(instant)).not.toBe(instant);
  });

  it("keeps the native error for an invalid string", () => {
    expect(Number.isNaN(toMs("not a date"))).toBe(true);
    expect(() => toIsoString("not a date")).toThrow(RangeError);
  });

  it("reads the current time from the system clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_792_888_200_999);
    expect(currentMs()).toBe(1_792_888_200_999);
    expect(currentSeconds()).toBe(1_792_888_200);
    expect(currentDate().getTime()).toBe(1_792_888_200_999);
  });
});
