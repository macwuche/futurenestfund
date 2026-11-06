import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { DemoInputError } from "./lib/demoWorkspace";
import { RecordInputError } from "./lib/applicantRecords";
import { TierLimitError } from "./lib/tierRules";
import { UploadError } from "./lib/uploads";
import { ScanUnavailableError } from "./lib/virusScan";
import { sendEmailHook } from "./lib/sendEmailHook";
import { hookLimit } from "./lib/rateLimit";
import { forwardError, shortReference } from "./lib/monitoring";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    // A random id per request, on every log line and in the X-Request-Id response header, so a user's reference can be found.
    genReqId: (_req, res) => {
      const id = randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
// Behind nginx on the VPS set TRUST_PROXY=1 (the number of proxies in front), so req.ip and req.secure are the visitor's.
const trustProxy = process.env.TRUST_PROXY?.trim();
if (trustProxy) app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  // The API only returns JSON and files: nothing may frame it, run scripts in it or embed it cross-site.
  // (Downloads set their own sandboxed CSP in lib/uploads.ts.)
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});
// Signed by Supabase over the exact bytes, so it needs the raw body and must come before express.json().
app.post("/api/hooks/supabase/send-email", hookLimit, express.raw({ type: () => true, limit: "64kb" }), sendEmailHook);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof TierLimitError) {
    res.status(400).json({ error: err.message, ...(err.upgradeTier ? { upgradeTier: err.upgradeTier } : {}) });
    return;
  }
  if (err instanceof DemoInputError || err instanceof RecordInputError || err instanceof UploadError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof ScanUnavailableError) {
    // Uploads fail closed while the scanner is down; logged as an error so it gets noticed.
    req.log.error({ err: { message: err.message } }, "Upload refused: virus scanner unavailable");
    res.status(503).json({ error: "Uploads are paused for a moment because the virus scanner isn't responding. Please try again in a few minutes." });
    return;
  }
  req.log.error({ err }, "Request failed");
  const requestId = String(req.id);
  const e = err instanceof Error ? err : new Error(String(err));
  forwardError({ source: "server", type: e.name, message: e.message, stack: e.stack, requestId, method: req.method, path: req.originalUrl });
  res.status(500).json({ error: `The workspace could not complete this request. Please try again. If it keeps happening, contact support with reference ${shortReference(requestId)}.`, requestId });
});

export default app;
