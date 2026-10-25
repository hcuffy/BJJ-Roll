import { serve } from "@hono/node-server";
import { createAppFromEnvironment } from "./app.js";

const { app, config } = createAppFromEnvironment();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.warn(`Backend listening on port ${String(info.port)}`);
});
