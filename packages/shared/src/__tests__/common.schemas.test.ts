import { describe, expect, it } from "vitest";
import {
  eventLabelSchema,
  identifierSchema,
  positionLabelSchema,
  roleSchema,
  styleSchema,
  timestampSchema,
  videoTimestampMillisecondsSchema,
  visibilitySchema,
} from "../index.js";
import { invalidIdentifier, offsetLessTimestamp, timestamp, videoId } from "./sampleValues.js";

const cases = [
  { name: "identifierSchema", schema: identifierSchema, valid: videoId, invalid: invalidIdentifier },
  { name: "timestampSchema", schema: timestampSchema, valid: timestamp, invalid: offsetLessTimestamp },
  { name: "videoTimestampMillisecondsSchema", schema: videoTimestampMillisecondsSchema, valid: 1500, invalid: -1 },
  { name: "styleSchema", schema: styleSchema, valid: "no-gi", invalid: "nogi" },
  { name: "visibilitySchema", schema: visibilitySchema, valid: "private", invalid: "public" },
  { name: "positionLabelSchema", schema: positionLabelSchema, valid: "closed_guard", invalid: "rubber_guard" },
  { name: "eventLabelSchema", schema: eventLabelSchema, valid: "sweep", invalid: "slam" },
  { name: "roleSchema", schema: roleSchema, valid: "top", invalid: "middle" },
];

describe("common schemas (ARCHITECTURE.md §2.1)", () => {
  it.each(cases)("$name parses a valid sample", ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("$name rejects an invalid sample", ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects fractional milliseconds", () => {
    expect(videoTimestampMillisecondsSchema.safeParse(12.5).success).toBe(false);
  });
});
