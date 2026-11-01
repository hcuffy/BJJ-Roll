import { Pool } from "pg";

export interface ServerEventLine {
  readonly event: string;
  readonly [field: string]: string | number | boolean;
}

export type ServerEventLogger = (line: ServerEventLine) => void;

export function logServerEventToStderr(line: ServerEventLine): void {
  console.error(JSON.stringify(line));
}

const safeErrorCodePattern = /^[A-Z0-9_]{1,32}$/u;

export function safeErrorCode(error: unknown): string {
  const code: unknown = error instanceof Object && "code" in error ? error.code : undefined;
  return typeof code === "string" && safeErrorCodePattern.test(code) ? code : "unknown";
}

export function errorClassName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

export function createServerPool(connectionString: string, logEvent: ServerEventLogger = logServerEventToStderr): Pool {
  const pool = new Pool({ connectionString });
  pool.on("error", (error) => {
    logEvent({ event: "db_pool_error", errorClass: errorClassName(error), code: safeErrorCode(error) });
  });
  return pool;
}

export interface ShutdownSteps {
  readonly closeServer: () => Promise<void>;
  readonly stopEmailQueue: () => Promise<void>;
  readonly stopBackgroundJobs: () => Promise<void>;
  readonly endPool: () => Promise<void>;
}

export interface ShutdownOptions {
  readonly hardCapMs?: number;
  readonly logEvent?: ServerEventLogger;
}

const SHUTDOWN_HARD_CAP_MS = 10_000;

async function runShutdownSteps(steps: ShutdownSteps, logEvent: ServerEventLogger): Promise<number> {
  let exitCode = 0;
  for (const [name, step] of Object.entries(steps) as [keyof ShutdownSteps, () => Promise<void>][]) {
    try {
      await step();
    } catch (error) {
      exitCode = 1;
      logEvent({ event: "shutdown_step_failed", step: name, errorClass: errorClassName(error) });
    }
  }
  return exitCode;
}

export async function shutDownServer(steps: ShutdownSteps, options: ShutdownOptions = {}): Promise<number> {
  const logEvent = options.logEvent ?? logServerEventToStderr;
  let timer: NodeJS.Timeout | undefined;
  const hardCap = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      logEvent({ event: "shutdown_timed_out" });
      resolve(1);
    }, options.hardCapMs ?? SHUTDOWN_HARD_CAP_MS);
    timer.unref();
  });
  const orderedSteps: ShutdownSteps = {
    closeServer: steps.closeServer,
    stopEmailQueue: steps.stopEmailQueue,
    stopBackgroundJobs: steps.stopBackgroundJobs,
    endPool: steps.endPool,
  };
  try {
    return await Promise.race([runShutdownSteps(orderedSteps, logEvent), hardCap]);
  } finally {
    clearTimeout(timer);
  }
}
