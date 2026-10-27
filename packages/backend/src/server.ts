import { serve } from "@hono/node-server";
import { createAppFromEnvironment } from "./app.js";

const { app, config, emailQueue } = createAppFromEnvironment();

// The email worker runs in this process (HEN-284). Jobs live in Postgres, so a restart picks up what was not sent yet.
await emailQueue.start();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`Backend listening on port ${String(info.port)}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close();
    void emailQueue.stop().finally(() => process.exit(0));
  });
}
