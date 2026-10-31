import { jobResultSchema, modalCallInputSchema, type JobQueue, type JobResult, type ModalCallInput } from "@bjj-roll/shared";

export const modalAppName = "bjj-roll-workers";

export const modalFunctionNames = {
  video_track: "track_video",
  video_classify: "classify_video",
  video_render_masked: "render_masked_video",
} as const satisfies Partial<Record<JobQueue, string>>;

type ModalQueue = keyof typeof modalFunctionNames;

interface RemoteOnlyFunction {
  remote(positionalArguments: unknown[]): Promise<unknown>;
}

export interface ModalFunctionLookup {
  fromName(appName: string, name: string): Promise<RemoteOnlyFunction>;
}

export interface ModalJobRequest {
  queue: ModalQueue;
  input: ModalCallInput;
}

class ModalJobCallError extends Error {
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
