import { describe, expect, it } from "vitest";
import { shutDownServer, type ShutdownSteps } from "../serverProcess.js";

function recordingSteps(calls: string[], overrides: Partial<ShutdownSteps> = {}): ShutdownSteps {
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    closeServer: step("closeServer"),
    stopEmailQueue: step("stopEmailQueue"),
    stopBackgroundJobs: step("stopBackgroundJobs"),
    endPool: step("endPool"),
    ...overrides,
  };
}

describe("B11 SIGTERM closes the server, then the queues, then the pool", () => {
  it("runs every step in order and exits 0", async () => {
    const calls: string[] = [];

    const exitCode = await shutDownServer(recordingSteps(calls));

    expect(calls).toEqual(["closeServer", "stopEmailQueue", "stopBackgroundJobs", "endPool"]);
    expect(exitCode).toBe(0);
  });

  it("still closes the pool when a step fails, and exits 1", async () => {
    const calls: string[] = [];
    const steps = recordingSteps(calls, {
      stopEmailQueue: () => {
        calls.push("stopEmailQueue");
        return Promise.reject(new Error("queue stop failed"));
      },
    });

    const exitCode = await shutDownServer(steps);

    expect(calls).toEqual(["closeServer", "stopEmailQueue", "stopBackgroundJobs", "endPool"]);
    expect(exitCode).toBe(1);
  });

  it("gives up after the hard cap and exits 1 when a step hangs", async () => {
    const calls: string[] = [];
    const steps = recordingSteps(calls, { closeServer: () => new Promise<void>(() => undefined) });

    const exitCode = await shutDownServer(steps, { hardCapMs: 50 });

    expect(exitCode).toBe(1);
    expect(calls).toEqual([]);
  });
});
