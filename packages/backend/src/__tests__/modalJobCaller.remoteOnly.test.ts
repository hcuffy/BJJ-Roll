import type { ModalClient } from "modal";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { callModalJob, modalAppName, modalFunctionNames, type ModalFunctionLookup } from "../jobs/modalJobCaller.js";

const jobId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const inputObjectKey = "videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/source.mp4";
const succeededResult = { outcome: "succeeded", jobId, outputObjectKeys: [], needsUserConfirmation: false };

function createFakeModal(remoteOutput: unknown) {
  const modalFunction = { remote: vi.fn(() => Promise.resolve(remoteOutput)), spawn: vi.fn(() => Promise.resolve({})) };
  const lookup = { fromName: vi.fn(() => Promise.resolve(modalFunction)) };
  return { modalFunction, lookup };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callModalJob (HEN-227 remote-only caller)", () => {
  it("calls `.remote()` once with only the job ID and object key, and never a spawn-style call", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { modalFunction, lookup } = createFakeModal(succeededResult);

    const result = await callModalJob(lookup, { queue: "video_track", input: { jobId, inputObjectKey } });

    expect(result).toEqual(succeededResult);
    expect(lookup.fromName).toHaveBeenCalledWith(modalAppName, "track_video");
    expect(modalFunction.remote).toHaveBeenCalledExactlyOnceWith([jobId, inputObjectKey]);
    expect(modalFunction.spawn).not.toHaveBeenCalled();
  });

  it("refuses input that is not a job ID plus object key before reaching Modal", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { modalFunction, lookup } = createFakeModal(succeededResult);
    const input = { jobId, inputObjectKey: `${inputObjectKey}?X-Amz-Signature=synthetic` };

    await expect(callModalJob(lookup, { queue: "video_track", input })).rejects.toThrow("Modal job call failed");
    expect(lookup.fromName).not.toHaveBeenCalled();
    expect(modalFunction.remote).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ event: "modal_call_rejected", jobId: null, errorClass: "InvalidModalCallInput" })}\n`,
    );
  });

  it("rejects a result for another job", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const { lookup } = createFakeModal({ ...succeededResult, jobId: "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e" });

    await expect(callModalJob(lookup, { queue: "video_classify", input: { jobId, inputObjectKey } })).rejects.toThrow("Modal job call failed");
  });

  it("maps every Modal queue to its user-data function in packages/workers", () => {
    expect(modalFunctionNames).toEqual({ video_track: "track_video", video_classify: "classify_video", video_render_masked: "render_masked_video" });
  });

  it("matches the Modal JS SDK and exposes no spawn-style call", () => {
    expectTypeOf<ModalClient["functions"]>().toExtend<ModalFunctionLookup>();
    expectTypeOf<Awaited<ReturnType<ModalFunctionLookup["fromName"]>>>().not.toHaveProperty("spawn");
  });
});
