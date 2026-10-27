import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailSendError } from "../email/index.js";
import { deliverSignInEmail, enqueueSignInEmail, SIGN_IN_EMAIL_ATTEMPTS, SIGN_IN_EMAIL_RETRY_DELAYS_MS } from "../auth/signInEmailQueue.js";

const fakeAddress = "retry.test.person@example.com";

function captureStdout() {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, spy };
}

function failingTimes(failures: number, error: Error = new EmailSendError("network")) {
  let calls = 0;
  const send = () => {
    calls += 1;
    return calls <= failures ? Promise.reject(error) : Promise.resolve();
  };
  return { send, calls: () => calls };
}

describe("HEN-263 sign-in email bounded retry (no durable queue on main yet)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tries 3 times with 1 s then 2 s backoff, and stops at the first success", async () => {
    expect(SIGN_IN_EMAIL_ATTEMPTS).toBe(3);
    const waits: number[] = [];
    const wait = (milliseconds: number) => {
      waits.push(milliseconds);
      return Promise.resolve();
    };
    const { lines } = captureStdout();

    const flaky = failingTimes(2);
    await deliverSignInEmail(flaky.send, { wait });
    expect(flaky.calls()).toBe(3);
    expect(waits).toEqual([...SIGN_IN_EMAIL_RETRY_DELAYS_MS]);
    expect(waits).toEqual([1000, 2000]);

    waits.length = 0;
    const healthy = failingTimes(0);
    await deliverSignInEmail(healthy.send, { wait });
    expect(healthy.calls()).toBe(1);
    expect(waits).toEqual([]);
    expect(lines.join("")).not.toContain("sign_in_email_failed");
  });

  it("after the last failed try logs sign_in_email_failed once, with reason and tries only, and never throws", async () => {
    const { lines } = captureStdout();
    const broken = failingTimes(Number.POSITIVE_INFINITY, new EmailSendError("http_status", 503));
    await expect(deliverSignInEmail(broken.send, { wait: () => Promise.resolve() })).resolves.toBeUndefined();
    expect(broken.calls()).toBe(3);
    const failures = lines.filter((line) => line.includes("sign_in_email_failed"));
    expect(failures.map((line) => JSON.parse(line) as unknown)).toEqual([{ event: "sign_in_email_failed", reason: "http_status", attempts: 3 }]);
  });

  it("logs no address, code or link even when a non-typed error carries them", async () => {
    const { lines } = captureStdout();
    const leaky = failingTimes(Number.POSITIVE_INFINITY, new Error(`rejected ${fakeAddress} code=123456 url=bjjroll://auth/magic?token=fake`));
    await deliverSignInEmail(leaky.send, { wait: () => Promise.resolve() });
    const logged = lines.join("");
    expect(JSON.parse(logged.trim())).toEqual({ event: "sign_in_email_failed", reason: "unknown", attempts: 3 });
    expect(logged).not.toContain(fakeAddress);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("bjjroll://");
  });

  it("enqueueSignInEmail returns before the first try settles", () => {
    let settled = false;
    enqueueSignInEmail(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            settled = true;
            resolve();
          }, 50);
        }),
    );
    expect(settled).toBe(false);
  });
});
