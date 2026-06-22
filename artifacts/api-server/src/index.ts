import app from "./app";
import { logger } from "./lib/logger";
import { botManager } from "./lib/botManager";
import { loadAppSettings } from "./lib/appSettings";

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
