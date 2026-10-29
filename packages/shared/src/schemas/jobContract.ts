import { z } from "zod";
import { identifierSchema, styleSchema } from "./common.js";
import { timelineSegmentSchema } from "./coreEntities.js";

// ARCHITECTURE.md §3.5: Hono ↔ worker job payload and result schemas.
export const jobQueueSchema = z.enum([
  "video_transcode",
  "video_timeline_gemini",
  "video_track",
  "video_classify",
  "video_render_masked",
  "video_delete",
]);

// Stored in pgboss.job.data. Ids only: no email, no filename, no URL, no bytes (HEN-227).
export const jobPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  queue: jobQueueSchema,
  videoId: identifierSchema,
  inputObjectKey: z.string().regex(/^videos\/[0-9a-f-]{36}\//),
});

// Server-built key of the video a Modal function reads: never an uploaded filename, URL, query string or email (HEN-227).
export const modalInputObjectKeySchema = z
  .string()
  .regex(/^videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(source|transcode)\.[a-z0-9]{2,4}$/);

// The only arguments the Modal function receives. Strict: any extra field (bytes, URL, email, filename) is rejected (HEN-227).
export const modalCallInputSchema = z.strictObject({
  jobId: identifierSchema,
  inputObjectKey: modalInputObjectKeySchema,
});

// Fetched by the worker from GET /internal/jobs/{jobId} while the job is active.
export const jobParametersSchema = z.object({
  jobId: identifierSchema,
  queue: jobQueueSchema,
  style: styleSchema,
  tapPoint: z.object({ frameIndex: z.int().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(), // video_track only
});

export const jobErrorClassSchema = z.enum(["input_unreadable", "tracking_lost", "vendor_unavailable", "timeout", "internal"]);

// Returned by .remote(). Must stay under 2 MiB to stay in Modal's EU routing region (HEN-227).
export const jobResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("succeeded"),
    jobId: identifierSchema,
    outputObjectKeys: z.array(z.string()).max(20),
    timelineSegments: z.array(timelineSegmentSchema.omit({ id: true })).optional(),
    needsUserConfirmation: z.boolean(), // "Was this you?" re-prompt (HEN-72)
  }),
  z.object({ outcome: z.literal("failed"), jobId: identifierSchema, errorClass: jobErrorClassSchema, retryable: z.boolean() }),
]);

export type JobQueue = z.infer<typeof jobQueueSchema>;
export type JobPayload = z.infer<typeof jobPayloadSchema>;
export type ModalCallInput = z.infer<typeof modalCallInputSchema>;
export type JobParameters = z.infer<typeof jobParametersSchema>;
export type JobErrorClass = z.infer<typeof jobErrorClassSchema>;
export type JobResult = z.infer<typeof jobResultSchema>;
