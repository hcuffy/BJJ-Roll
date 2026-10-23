import { z } from "zod";
import {
  identifierSchema,
  positionLabelSchema,
  roleSchema,
  styleSchema,
  timestampSchema,
  videoTimestampMillisecondsSchema,
  visibilitySchema,
} from "./common.js";
import { handleSchema } from "./handle.js";

// ARCHITECTURE.md §2.2: core entities (user, video, timeline, correction).
export const userSchema = z.object({
  id: identifierSchema,
  handle: handleSchema.nullable(), // D19. Null until chosen (HEN-64); length limits: OPEN (Henry), see limits.ts
  createdAt: timestampSchema,
}); // The email never leaves the backend: email_ciphertext and email_hash are DB columns only (D18).

export const videoProcessingStatusSchema = z.enum(["uploading", "queued", "processing", "needs_user", "ready", "failed"]);

export const videoSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  style: styleSchema,
  visibility: visibilitySchema.default("private"),
  processingStatus: videoProcessingStatusSchema,
  durationMilliseconds: z.int().positive().optional(),
  sharesRestrictedAt: timestampSchema.nullable(), // set by a "minor visible" report (M6-17, HEN-200)
  createdAt: timestampSchema,
});

export const timelineSegmentSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  position: positionLabelSchema,
  role: roleSchema,
  confidence: z.enum(["high", "medium", "low"]), // semantic categories, not raw percentages (Lydia's UI research)
  source: z.enum(["gemini_v0", "computer_vision_v1", "user_correction"]),
});

export const correctionSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  userId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  label: positionLabelSchema, // PLAN M4 task 7: (video_id, t0, t1, label, user_id)
  levelTwoDetail: z.string().optional(), // HEN-44 level 2 pick list id
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type VideoProcessingStatus = z.infer<typeof videoProcessingStatusSchema>;
export type Video = z.infer<typeof videoSchema>;
export type TimelineSegment = z.infer<typeof timelineSegmentSchema>;
export type Correction = z.infer<typeof correctionSchema>;
