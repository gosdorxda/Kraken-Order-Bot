import dotenv from "dotenv";

// On the VPS, secrets/config live in /opt/krkn-bot/.env (outside this
// package's own directory). This must load and populate process.env BEFORE
// any other module is evaluated, since some modules (e.g. krakenBot.ts)
// read API keys from process.env at import time, not lazily inside a
// function. Static `import` declarations are hoisted above all other code
// in ESM, so a plain `import ... ; dotenv.config(...)` further down the
// file would run too late. Using dynamic `import()` after `dotenv.config()`
// guarantees ordering. If the file doesn't exist (e.g. local/Replit dev,
// where env vars are injected directly by the platform), dotenv just
// no-ops — it never overrides variables that are already set.
dotenv.config({ path: "/opt/krkn-bot/.env" });

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");
const { botManager } = await import("./lib/botManager");
const { loadAppSettings } = await import("./lib/appSettings");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

Promise.all([botManager.initialize(), loadAppSettings()]).then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}).catch((err: unknown) => {
  logger.error({ err }, "Failed to initialize bot manager");
  process.exit(1);
});
