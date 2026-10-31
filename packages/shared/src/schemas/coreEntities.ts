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

export const userSchema = z.object({
  id: identifierSchema,
  handle: handleSchema.nullable(),
  createdAt: timestampSchema,
});

export const videoProcessingStatusSchema = z.enum(["uploading", "queued", "processing", "needs_user", "ready", "failed"]);

export const videoSchema = z.object({
  id: identifierSchema,
  ownerId: identifierSchema,
  style: styleSchema,
  visibility: visibilitySchema.default("private"),
  processingStatus: videoProcessingStatusSchema,
  durationMilliseconds: z.int().positive().optional(),
  sharesRestrictedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});

export const timelineSegmentSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  position: positionLabelSchema,
  role: roleSchema,
  confidence: z.enum(["high", "medium", "low"]),
  source: z.enum(["gemini_v0", "computer_vision_v1", "user_correction"]),
});

export const correctionSchema = z.object({
  id: identifierSchema,
  videoId: identifierSchema,
  userId: identifierSchema,
  startMilliseconds: videoTimestampMillisecondsSchema,
  endMilliseconds: videoTimestampMillisecondsSchema,
  label: positionLabelSchema,
  levelTwoDetail: z.string().optional(),
  createdAt: timestampSchema,
});

export type User = z.infer<typeof userSchema>;
export type VideoProcessingStatus = z.infer<typeof videoProcessingStatusSchema>;
export type Video = z.infer<typeof videoSchema>;
export type TimelineSegment = z.infer<typeof timelineSegmentSchema>;
export type Correction = z.infer<typeof correctionSchema>;
