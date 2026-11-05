import { Router, type IRouter } from "express";
import { ReportClientErrorBody, ReportClientErrorResponse, GetMonitoringStatusResponse } from "@workspace/api-zod";
import { forwardError, monitoringStatus, scrub, shortReference } from "../lib/monitoring";
import { rateLimit, rateLimitStatus } from "../lib/rateLimit";
import { scanStatus } from "../lib/virusScan";

const n = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
/** Browser crash reports, per IP: a broken page can fire errors in a loop. */
const clientErrorLimit = rateLimit({ name: "client-errors", limit: n(process.env.RATE_LIMIT_CLIENT_ERRORS_PER_MIN, 20), windowMs: 60_000, key: (req) => `client-errors:${req.ip}` });

/** Mounted before sign-in is checked: a crash on the sign-in page must still be reported. */
export const clientErrorsRouter: IRouter = Router();
clientErrorsRouter.post("/client-errors", clientErrorLimit, (req, res): void => {
  const input = ReportClientErrorBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Not a valid error report." }); return; }
  const r = input.data;
  const report = { source: "browser" as const, type: r.type || "Error", message: r.message, stack: r.stack, kind: r.kind, path: r.path.split("?")[0], requestId: String(req.id) };
  // Same scrubbing for the log as for Sentry: the message and stack come from the visitor's browser.
  req.log.error({ clientError: { ...report, message: scrub(report.message, 1000), stack: report.stack && scrub(report.stack, 8000) } }, "Browser error");
  forwardError(report);
  res.status(202).json(ReportClientErrorResponse.parse({ reference: shortReference(String(req.id)) }));
});

/** Under /admin (admins only). */
export const monitoringAdminRouter: IRouter = Router();
monitoringAdminRouter.get("/admin/monitoring", async (_req, res): Promise<void> => {
  res.json(GetMonitoringStatusResponse.parse({ ...monitoringStatus(), virusScan: await scanStatus(), rateLimits: await rateLimitStatus() }));
});
monitoringAdminRouter.post("/admin/monitoring/test-error", (): void => {
  throw new Error("Monitoring test: a deliberate error raised from Admin settings");
});
