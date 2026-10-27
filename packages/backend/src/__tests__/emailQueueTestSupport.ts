import { loadAuthKeyringFromEnvironment, generateTestAuthSecrets } from "../auth/index.js";
import { PgBossEmailQueue, type EmailQueueLogLine, type PgBossEmailQueueOptions } from "../email/index.js";

/** Polls until `condition` holds, or fails after `timeoutMilliseconds`. */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMilliseconds = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${String(timeoutMilliseconds)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function createTestKeyring() {
  return loadAuthKeyringFromEnvironment(generateTestAuthSecrets());
}

/** A queue on the suite database with fast polling; `logLines` collects its dead-letter log. */
export function createTestEmailQueue(
  options: Omit<PgBossEmailQueueOptions, "logEvent" | "pollingIntervalSeconds" | "keyring"> & Partial<PgBossEmailQueueOptions>,
) {
  const logLines: EmailQueueLogLine[] = [];
  const queue = new PgBossEmailQueue({
    keyring: createTestKeyring(),
    pollingIntervalSeconds: 0.5,
    logEvent: (line) => logLines.push(line),
    ...options,
  });
  return { queue, logLines };
}
