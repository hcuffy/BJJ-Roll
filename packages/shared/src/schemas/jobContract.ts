import { z } from "zod";
import { identifierSchema, styleSchema } from "./common.js";
import { timelineSegmentSchema } from "./coreEntities.js";

export const jobQueueSchema = z.enum([
  "video_transcode",
  "video_timeline_gemini",
  "video_track",
  "video_classify",
  "video_render_masked",
  "video_delete",
]);

export const jobPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  queue: jobQueueSchema,
  videoId: identifierSchema,
  inputObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\//),
});

export const modalInputObjectKeySchema = z
  .string()
  .regex(/^videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(source|transcode)\.[a-z0-9]{2,4}$/);

export const modalCallInputSchema = z.strictObject({
  jobId: identifierSchema,
  inputObjectKey: modalInputObjectKeySchema,
});

export const jobParametersSchema = z.object({
  jobId: identifierSchema,
  queue: jobQueueSchema,
  style: styleSchema,
  tapPoint: z.object({ frameIndex: z.int().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

export const jobErrorClassSchema = z.enum(["input_unreadable", "tracking_lost", "vendor_unavailable", "timeout", "internal"]);

export const jobResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("succeeded"),
    jobId: identifierSchema,
    outputObjectKeys: z.array(z.string()).max(20),
    timelineSegments: z.array(timelineSegmentSchema.omit({ id: true })).optional(),
    needsUserConfirmation: z.boolean(),
  }),
  z.object({ outcome: z.literal("failed"), jobId: identifierSchema, errorClass: jobErrorClassSchema, retryable: z.boolean() }),
]);

export type JobQueue = z.infer<typeof jobQueueSchema>;
export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type ModalCallInput = z.infer<typeof modalCallInputSchema>;
export type JobParameters = z.infer<typeof jobParametersSchema>;
export type JobErrorClass = z.infer<typeof jobErrorClassSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;
