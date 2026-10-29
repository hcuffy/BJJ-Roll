import { jobResultSchema, modalCallInputSchema, type JobQueue, type JobResult, type ModalCallInput } from "@bjj-roll/shared";

// HEN-227, HEN-48 option A: the jobRunner claims a pg-boss job and calls the Modal `eu` function through the JS SDK with `.remote()` only.
// Inputs routed outside `.remote()` go through Modal's us-east storage, so the Modal function type below exposes nothing else.
export const modalAppName = "bjj-roll-workers";

// Queues that run on Modal `eu` (ARCHITECTURE §3.2) and the user-data function in packages/workers each one calls.
export const modalFunctionNames = {
  video_track: "track_video",
  video_classify: "classify_video",
  video_render_masked: "render_masked_video",
} as const satisfies Partial<Record<JobQueue, string>>;

export type ModalQueue = keyof typeof modalFunctionNames;

export interface RemoteOnlyFunction {
  remote(positionalArguments: unknown[]): Promise<unknown>;
}

// `ModalClient["functions"]` from the `modal` SDK satisfies this (type test in `modalJobCaller.remoteOnly.test.ts`).
export interface ModalFunctionLookup {
  fromName(appName: string, name: string): Promise<RemoteOnlyFunction>;
}

export interface ModalJobRequest {
  queue: ModalQueue;
  input: ModalCallInput;
}

// Carries only the error class: the original message may hold a URL, query string or token, so it is never kept or chained.
export class ModalJobCallError extends Error {
  readonly errorClass: string;

  constructor(errorClass: string) {
    super("Modal job call failed");
    this.name = "ModalJobCallError";
    this.errorClass = errorClass;
  }
}

interface ModalCallLogEntry {
  event: "modal_call_rejected" | "modal_call_completed" | "modal_call_failed";
  jobId: string | null;
  durationMilliseconds?: number;
  errorClass?: string;
}

// Structured log: job IDs, timings and error classes only (HEN-227).
function logModalCall(entry: ModalCallLogEntry): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function errorClassName(error: unknown): string {
  if (error instanceof ModalJobCallError) {
    return error.errorClass;
  }
  const className = error instanceof Error ? error.constructor.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(className) ? className : "UnknownError";
}

async function remoteCall(lookup: ModalFunctionLookup, request: ModalJobRequest, input: ModalCallInput): Promise<JobResult> {
  const modalFunction = await lookup.fromName(modalAppName, modalFunctionNames[request.queue]);
  const parsedResult = jobResultSchema.safeParse(await modalFunction.remote([input.jobId, input.inputObjectKey]));
  if (!parsedResult.success || parsedResult.data.jobId !== input.jobId) {
    throw new ModalJobCallError("InvalidModalResult");
  }
  return parsedResult.data;
}

export async function callModalJob(lookup: ModalFunctionLookup, request: ModalJobRequest): Promise<JobResult> {
  const parsedInput = modalCallInputSchema.safeParse(request.input);
  if (!parsedInput.success) {
    logModalCall({ event: "modal_call_rejected", jobId: null, errorClass: "InvalidModalCallInput" });
    throw new ModalJobCallError("InvalidModalCallInput");
  }
  const input = parsedInput.data;
  const startedAt = performance.now();
  try {
    const result = await remoteCall(lookup, request, input);
    logModalCall({ event: "modal_call_completed", jobId: input.jobId, durationMilliseconds: Math.round(performance.now() - startedAt) });
    return result;
  } catch (error) {
    const errorClass = errorClassName(error);
    logModalCall({ event: "modal_call_failed", jobId: input.jobId, durationMilliseconds: Math.round(performance.now() - startedAt), errorClass });
    throw new ModalJobCallError(errorClass);
  }
}
