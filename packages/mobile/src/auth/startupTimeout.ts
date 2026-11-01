export const STARTUP_REQUEST_TIMEOUT_MS = 10_000;

class StartupTimeoutError extends Error {
  override readonly name = "StartupTimeoutError";
}

export interface StartupBudget {
  readonly run: <T>(step: (signal: AbortSignal) => Promise<T>) => Promise<T>;
}

export function createStartupBudget(): StartupBudget {
  const controller = new AbortController();
  const deadline = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new StartupTimeoutError("Startup request timed out"));
      controller.abort();
    }, STARTUP_REQUEST_TIMEOUT_MS);
  });
  deadline.catch(() => undefined);
  return { run: (step) => (controller.signal.aborted ? deadline : Promise.race([step(controller.signal), deadline])) };
}

export function startupDeadline(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), STARTUP_REQUEST_TIMEOUT_MS);
  return controller.signal;
}

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
