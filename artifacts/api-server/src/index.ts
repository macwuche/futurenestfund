import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoData } from "./lib/demoSeed";
import { database } from "@workspace/db";
import { startNotificationMailer } from "./lib/notificationMailer";
import { flushReports, forwardError } from "./lib/monitoring";

// Errors outside a request: logged and reported. A crash still exits (systemd restarts the service), after sending.
const asError = (v: unknown) => (v instanceof Error ? v : new Error(String(v)));
process.on("unhandledRejection", (reason) => {
  const e = asError(reason);
  logger.error({ err: e }, "Unhandled promise rejection");
  forwardError({ source: "server", type: e.name, message: e.message, stack: e.stack, kind: "unhandledrejection" });
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception; exiting");
  forwardError({ source: "server", type: err.name, message: err.message, stack: err.stack, kind: "uncaughtexception" });
  void flushReports().finally(() => process.exit(1));
});

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

await seedDemoData();
startNotificationMailer();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, database: database.target }, "Server listening");
});
