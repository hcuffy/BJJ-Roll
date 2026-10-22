import { z } from "zod";
import { eventLabelSchema, identifierSchema, positionLabelSchema, timestampSchema, videoTimestampMillisecondsSchema } from "./common.js";
import { textNoteMaximumLength, voiceNoteMaximumDurationMilliseconds } from "./limits.js";

// ARCHITECTURE.md §2.5: notes (text and voice).
const noteBaseSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  authorId: identifierSchema,
  videoTimestampMilliseconds: videoTimestampMillisecondsSchema, // where on the video the note is pinned
  accessGrantId: identifierSchema.nullable(), // null when the owner writes on their own video
  reviewId: identifierSchema.nullable(), // set when the note is part of a paid review breakdown
  positionLabel: positionLabelSchema.optional(), // M10-10: optional HEN-44 tag
  eventLabel: eventLabelSchema.optional(),
  createdAt: timestampSchema,
});

export const noteSchema = z.discriminatedUnion("kind", [
  noteBaseSchema.extend({
    kind: z.literal("text"),
    text: z.string().min(1).max(textNoteMaximumLength), // max length: OPEN (Henry), see limits.ts
  }),
  noteBaseSchema.extend({
    kind: z.literal("voice"),
    audioObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\/voice-notes\/[0-9a-f-]{36}\.m4a$/),
    durationMilliseconds: z.int().positive().max(voiceNoteMaximumDurationMilliseconds), // cap from M6-12 (HEN-195): OPEN (Henry), see limits.ts
  }),
]);

export type Note = z.infer<typeof noteSchema>;
