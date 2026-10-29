import { describe, expect, it } from "vitest";
import { modalCallInputSchema } from "../index.js";
import { otherId, videoId } from "./sampleValues.js";

// HEN-227: Modal receives a job ID and a server-built object key, nothing else. Synthetic values only.
const validInput = { jobId: otherId, inputObjectKey: `videos/${videoId}/source.mp4` };
const syntheticEmail = ["athlete", "example.invalid"].join("@");
const presignedQuery = ["X-Amz-Expires=300", "X-Amz-Signature=synthetic"].join("&");

const rejectedInputs = [
  { name: "video bytes as an extra field", input: { ...validInput, videoBytes: new Uint8Array([0, 1, 2]) } },
  { name: "video bytes as the object key", input: { ...validInput, inputObjectKey: new Uint8Array([0, 1, 2]) } },
  {
    name: "a URL with a query string",
    input: { ...validInput, inputObjectKey: `https://storage.example.invalid/videos/${videoId}/source.mp4?${presignedQuery}` },
  },
  { name: "an object key with a query string", input: { ...validInput, inputObjectKey: `videos/${videoId}/source.mp4?${presignedQuery}` } },
  { name: "a presigned URL as an extra field", input: { ...validInput, presignedUrl: `https://storage.example.invalid/x?${presignedQuery}` } },
  { name: "an email address as an extra field", input: { ...validInput, email: syntheticEmail } },
  { name: "an email address in the object key", input: { ...validInput, inputObjectKey: `videos/${videoId}/${syntheticEmail}.mp4` } },
  { name: "an uploaded filename in the object key", input: { ...validInput, inputObjectKey: `videos/${videoId}/IMG_4412.MOV` } },
  { name: "a descriptive filename in the object key", input: { ...validInput, inputObjectKey: `videos/${videoId}/open mat roll.mp4` } },
  { name: "a filename as an extra field", input: { ...validInput, originalFilename: "roll.mp4" } },
  { name: "a job ID that is not a UUID", input: { ...validInput, jobId: "job-1" } },
];

describe("modalCallInputSchema (HEN-227 payload validator)", () => {
  it("accepts a job ID and an object key", () => {
    expect(modalCallInputSchema.safeParse(validInput).success).toBe(true);
    expect(modalCallInputSchema.safeParse({ ...validInput, inputObjectKey: `videos/${videoId}/transcode.mp4` }).success).toBe(true);
  });

  it.each(rejectedInputs)("rejects $name", ({ input }) => {
    expect(modalCallInputSchema.safeParse(input).success).toBe(false);
  });
});
