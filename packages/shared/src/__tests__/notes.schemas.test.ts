import { describe, expect, it } from "vitest";
import { noteSchema, textNoteMaximumLengthPlaceholder, voiceNoteMaximumDurationMillisecondsPlaceholder } from "../index.js";
import { otherId, timestamp, userId, videoId } from "./sampleValues.js";

const noteBase = {
  id: otherId,
  videoId,
  authorId: userId,
  videoTimestampMilliseconds: 12_000,
  accessGrantId: null,
  reviewId: null,
  positionLabel: "side_control",
  createdAt: timestamp,
};
const textNote = { ...noteBase, kind: "text", text: "Frame earlier here." };
const voiceNote = { ...noteBase, kind: "voice", audioObjectKey: `videos/${videoId}/voice-notes/${otherId}.m4a`, durationMilliseconds: 15_000 };

describe("note schema (ARCHITECTURE.md §2.5)", () => {
  it("parses a valid text note and a valid voice note", () => {
    expect(noteSchema.safeParse(textNote).success).toBe(true);
    expect(noteSchema.safeParse(voiceNote).success).toBe(true);
  });

  it("rejects a text note longer than the placeholder limit", () => {
    expect(noteSchema.safeParse({ ...textNote, text: "a".repeat(textNoteMaximumLengthPlaceholder + 1) }).success).toBe(false);
  });

  it("rejects a voice note longer than the placeholder limit", () => {
    expect(noteSchema.safeParse({ ...voiceNote, durationMilliseconds: voiceNoteMaximumDurationMillisecondsPlaceholder + 1 }).success).toBe(false);
  });

  it("rejects negative and fractional video positions", () => {
    expect(noteSchema.safeParse({ ...textNote, videoTimestampMilliseconds: -5 }).success).toBe(false);
    expect(noteSchema.safeParse({ ...textNote, videoTimestampMilliseconds: 0.5 }).success).toBe(false);
  });

  it("rejects an unknown event label", () => {
    expect(noteSchema.safeParse({ ...textNote, eventLabel: "slam" }).success).toBe(false);
  });
});
