import { afterEach, describe, expect, it, vi } from "vitest";
import { callModalJob } from "../jobs/modalJobCaller.js";

const jobId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const inputObjectKey = "videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/source.mp4";
const syntheticEmail = ["athlete", "example.invalid"].join("@");
const presignedQuery = ["X-Amz-Credential=synthetic", "X-Amz-Signature=synthetic0signature"].join("&");
const presignedUrl = `https://storage.example.invalid/bucket/${inputObjectKey}?${presignedQuery}`;
const syntheticToken = ["synthetic", "bearer", "token", "0123456789"].join("-");
const uploadedFilename = "open-mat-roll-IMG_4412.MOV";
const forbiddenFragments = [
  presignedUrl,
  presignedQuery,
  "https://",
  "X-Amz-",
  syntheticEmail,
  "@",
  uploadedFilename,
  syntheticToken,
  inputObjectKey,
];

class RemoteVendorError extends Error {}

function captureStdout() {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callModalJob log scrub (HEN-227)", () => {
  it("logs only the job ID and error class when the Modal call throws data-laden errors", async () => {
    const lines = captureStdout();
    const message = `fetch ${presignedUrl} for ${syntheticEmail} (${uploadedFilename}) with ${syntheticToken}`;
    const lookup = { fromName: () => Promise.resolve({ remote: () => Promise.reject(new RemoteVendorError(message)) }) };

    const failure = await callModalJob(lookup, { queue: "video_track", input: { jobId, inputObjectKey } }).catch((error: unknown) => error);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(entry).toSorted()).toEqual(["durationMilliseconds", "errorClass", "event", "jobId"]);
    expect(entry).toMatchObject({ event: "modal_call_failed", jobId, errorClass: "RemoteVendorError" });
    expect(failure).toBeInstanceOf(Error);
    const thrownText = `${String(failure)} ${JSON.stringify(failure)} ${String((failure as Error).cause)}`;
    for (const fragment of forbiddenFragments) {
      expect(lines.join("")).not.toContain(fragment);
      expect(thrownText).not.toContain(fragment);
    }
  });

  it("logs a success with only the job ID and its timing", async () => {
    const lines = captureStdout();
    const result = {
      outcome: "succeeded",
      jobId,
      outputObjectKeys: [`videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/jobs/${jobId}/track.json`],
      needsUserConfirmation: false,
    };
    const lookup = { fromName: () => Promise.resolve({ remote: () => Promise.resolve(result) }) };

    await callModalJob(lookup, { queue: "video_track", input: { jobId, inputObjectKey } });

    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(entry).toSorted()).toEqual(["durationMilliseconds", "event", "jobId"]);
    expect(entry).toMatchObject({ event: "modal_call_completed", jobId });
    expect(lines.join("")).not.toContain("videos/");
  });

  it("names a non-Error rejection by a fixed class instead of printing it", async () => {
    const lines = captureStdout();
    const lookup = { fromName: () => Promise.resolve({ remote: () => Promise.reject(presignedUrl as unknown as Error) }) };

    await expect(callModalJob(lookup, { queue: "video_track", input: { jobId, inputObjectKey } })).rejects.toThrow("Modal job call failed");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ errorClass: "UnknownError" });
    expect(lines.join("")).not.toContain("https://");
  });
});
