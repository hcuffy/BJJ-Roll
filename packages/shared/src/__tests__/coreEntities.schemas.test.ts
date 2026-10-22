import { describe, expect, it } from "vitest";
import { correctionSchema, handleMaximumLength, timelineSegmentSchema, userSchema, videoProcessingStatusSchema, videoSchema } from "../index.js";
import { invalidIdentifier, offsetLessTimestamp, otherId, timestamp, userId, videoId } from "./sampleValues.js";

const user = { id: userId, handle: "test_handle", createdAt: timestamp };
const video = {
  id: videoId,
  ownerId: userId,
  style: "gi",
  processingStatus: "ready",
  durationMilliseconds: 360_000,
  sharesRestrictedAt: null,
  createdAt: timestamp,
};
const timelineSegment = {
  id: otherId,
  videoId,
  startMilliseconds: 0,
  endMilliseconds: 4000,
  position: "mount",
  role: "top",
  confidence: "high",
  source: "gemini_v0",
};
const correction = { id: otherId, videoId, userId, startMilliseconds: 0, endMilliseconds: 4000, label: "half_guard", createdAt: timestamp };

const cases = [
  { name: "userSchema", schema: userSchema, valid: user, invalid: { ...user, handle: "h".repeat(handleMaximumLength + 1) } },
  { name: "videoProcessingStatusSchema", schema: videoProcessingStatusSchema, valid: "needs_user", invalid: "done" },
  { name: "videoSchema", schema: videoSchema, valid: video, invalid: { ...video, ownerId: invalidIdentifier } },
  { name: "timelineSegmentSchema", schema: timelineSegmentSchema, valid: timelineSegment, invalid: { ...timelineSegment, startMilliseconds: 10.5 } },
  { name: "correctionSchema", schema: correctionSchema, valid: correction, invalid: { ...correction, createdAt: offsetLessTimestamp } },
];

describe("core entity schemas (ARCHITECTURE.md §2.2)", () => {
  it.each(cases)("$name parses a valid sample", ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("$name rejects an invalid sample", ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("defaults video visibility to private", () => {
    expect(videoSchema.parse(video).visibility).toBe("private");
  });

  it("rejects an unknown position label in a timeline segment", () => {
    expect(timelineSegmentSchema.safeParse({ ...timelineSegment, position: "rubber_guard" }).success).toBe(false);
  });
});
