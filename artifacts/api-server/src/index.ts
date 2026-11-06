import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoData } from "./lib/demoSeed";
import { database } from "@workspace/db";
import { startNotificationMailer } from "./lib/notificationMailer";
import { loadEmailSettings, startEmailSettingsRefresh } from "./lib/emailSettings";
import { loadBranding, startBrandingRefresh } from "./lib/branding";
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

// On the VPS set HOST=127.0.0.1 so only nginx can reach the API; unset, it listens on every interface (Replit).
const host = process.env["HOST"]?.trim() || undefined;

await seedDemoData();
// Email settings saved in Admin Settings (they win over the env vars); re-read every minute.
await loadEmailSettings();
startEmailSettingsRefresh();
// Branding (name, colour, logo) for emails; re-read every minute so every process follows a change.
await loadBranding();
startBrandingRefresh();
startNotificationMailer();

const onListening = (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, host: host ?? "all interfaces", database: database.target }, "Server listening");
};
if (host) app.listen(port, host, onListening);
else app.listen(port, onListening);
