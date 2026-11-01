import { serve } from "@hono/node-server";
import { createAppFromEnvironment } from "./app.js";

const { app, config, emailQueue } = await createAppFromEnvironment();

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
