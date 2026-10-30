/**
 * How long all of startup (sign-out retry, session read, link exchange, gate status read) may take together;
 * React Native's fetch has no timeout (HEN-303, HEN-310).
 */
export const STARTUP_REQUEST_TIMEOUT_MS = 10_000;

/** Thrown when a budget runs out; the app treats it like an unreachable server. */
class StartupTimeoutError extends Error {
  override readonly name = "StartupTimeoutError";
}

/** One deadline shared by every step run in it: the steps together never take longer than STARTUP_REQUEST_TIMEOUT_MS (HEN-310). */
export interface StartupBudget {
  readonly run: <T>(step: (signal: AbortSignal) => Promise<T>) => Promise<T>;
}

/**
 * Starts the clock now. When it runs out, every step still running rejects and its requests are aborted; a step started
 * after that rejects at once. An answer that arrives later is ignored, so the screen changes once.
 */
export function createStartupBudget(): StartupBudget {
  const controller = new AbortController();
  const deadline = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new StartupTimeoutError("Startup request timed out"));
      controller.abort();
    }, STARTUP_REQUEST_TIMEOUT_MS);
  });
  // Nobody may be waiting when the deadline passes.
  deadline.catch(() => undefined);
  return { run: (step) => (controller.signal.aborted ? deadline : Promise.race([step(controller.signal), deadline])) };
}

/**
 * Runs one step with its own deadline (e.g. a sign-out tapped in the running app): after STARTUP_REQUEST_TIMEOUT_MS it
 * rejects and aborts the step's requests. An answer that arrives later is ignored, so the screen changes once.
 */
export async function withStartupTimeout<T>(step: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new StartupTimeoutError("Startup request timed out"));
      controller.abort();
    }, STARTUP_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([step(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
