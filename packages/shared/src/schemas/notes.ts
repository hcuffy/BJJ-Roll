import { z } from "zod";
import { eventLabelSchema, identifierSchema, positionLabelSchema, timestampSchema, videoTimestampMillisecondsSchema } from "./common.js";
import { textNoteMaximumLengthPlaceholder, voiceNoteMaximumDurationMillisecondsPlaceholder } from "./limits.js";

const noteBaseSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  authorId: identifierSchema,
  videoTimestampMilliseconds: videoTimestampMillisecondsSchema,
  accessGrantId: identifierSchema.nullable(),
  reviewId: identifierSchema.nullable(),
  positionLabel: positionLabelSchema.optional(),
  eventLabel: eventLabelSchema.optional(),
  createdAt: timestampSchema,
});

export const noteSchema = z.discriminatedUnion("kind", [
  noteBaseSchema.extend({
    kind: z.literal("text"),
    text: z.string().min(1).max(textNoteMaximumLengthPlaceholder),
  }),
  noteBaseSchema.extend({
    kind: z.literal("voice"),
    audioObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\/voice-notes\/[0-9a-f-]{36}\.m4a$/),
    durationMilliseconds: z.int().positive().max(voiceNoteMaximumDurationMillisecondsPlaceholder),
  }),
]);

export type Note = z.infer<typeof noteSchema>;
