import { serve } from "@hono/node-server";
import { createAppFromEnvironment } from "./app.js";
import { shutDownServer } from "./serverProcess.js";

const { app, config, pool, emailQueue, backgroundJobs } = await createAppFromEnvironment();

await emailQueue.start();
await backgroundJobs.start();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`Backend listening on port ${String(info.port)}`);
});

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutDownServer({
      closeServer,
      stopEmailQueue: () => emailQueue.stop(),
      stopBackgroundJobs: () => backgroundJobs.stop(),
      endPool: () => pool.end(),
    }).then((exitCode) => process.exit(exitCode));
  });
}
