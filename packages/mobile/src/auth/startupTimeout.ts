/** How long each startup request (sign-out retry, session read, link exchange) may take; React Native's fetch has no timeout (HEN-303). */
export const STARTUP_REQUEST_TIMEOUT_MS = 10_000;

/** Thrown by withStartupTimeout; the app treats it like an unreachable server. */
class StartupTimeoutError extends Error {
  override readonly name = "StartupTimeoutError";
}

/**
 * Runs one startup step with a deadline: after STARTUP_REQUEST_TIMEOUT_MS it rejects and aborts the step's requests.
 * An answer that arrives later is ignored, so the screen changes once.
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
