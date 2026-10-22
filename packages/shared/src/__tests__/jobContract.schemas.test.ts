import { describe, expect, it } from "vitest";
import { jobErrorClassSchema, jobParametersSchema, jobPayloadSchema, jobQueueSchema, jobResultSchema, modalCallInputSchema } from "../index.js";
import { invalidIdentifier, otherId, videoId } from "./sampleValues.js";

const jobPayload = { schemaVersion: 1, queue: "video_track", videoId, inputObjectKey: `videos/${videoId}/source.mp4` };
const modalCallInput = { jobId: otherId, inputObjectKey: jobPayload.inputObjectKey };
const jobParameters = { jobId: otherId, queue: "video_track", style: "gi", tapPoint: { frameIndex: 0, x: 0.4, y: 0.6 } };
const jobResult = {
  outcome: "succeeded",
  jobId: otherId,
  outputObjectKeys: [`videos/${videoId}/jobs/${otherId}/track.json`],
  needsUserConfirmation: false,
};

const cases = [
  { name: "jobQueueSchema", schema: jobQueueSchema, valid: "video_classify", invalid: "video_upload" },
  { name: "jobPayloadSchema", schema: jobPayloadSchema, valid: jobPayload, invalid: { ...jobPayload, videoId: invalidIdentifier } },
  {
    name: "modalCallInputSchema",
    schema: modalCallInputSchema,
    valid: modalCallInput,
    invalid: { ...modalCallInput, inputObjectKey: "uploads/source.mp4" },
  },
  {
    name: "jobParametersSchema",
    schema: jobParametersSchema,
    valid: jobParameters,
    invalid: { ...jobParameters, tapPoint: { frameIndex: 0, x: 1.5, y: 0.5 } },
  },
  { name: "jobErrorClassSchema", schema: jobErrorClassSchema, valid: "tracking_lost", invalid: "crashed" },
  {
    name: "jobResultSchema",
    schema: jobResultSchema,
    valid: jobResult,
    invalid: { outcome: "failed", jobId: otherId, errorClass: "crashed", retryable: true },
  },
];

describe("job contract schemas (ARCHITECTURE.md §3.5)", () => {
  it.each(cases)("$name parses a valid sample", ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(cases)("$name rejects an invalid sample", ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a job payload that carries an email or a URL (HEN-227: ids only)", () => {
    expect(jobPayloadSchema.safeParse({ ...jobPayload, email: "redacted" }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ...jobPayload, sourceUrl: "https://storage.example.com/video.mp4" }).success).toBe(false);
  });
});
