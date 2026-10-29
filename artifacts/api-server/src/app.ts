import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { DemoInputError } from "./lib/demoWorkspace";
import { RecordInputError } from "./lib/applicantRecords";
import { UploadError } from "./lib/uploads";
import { sendEmailHook } from "./lib/sendEmailHook";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
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
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
// Signed by Supabase over the exact bytes, so it needs the raw body and must come before express.json().
app.post("/api/hooks/supabase/send-email", express.raw({ type: () => true, limit: "64kb" }), sendEmailHook);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof DemoInputError || err instanceof RecordInputError || err instanceof UploadError) {
    res.status(400).json({ error: err.message });
    return;
  }
  req.log.error({ err }, "Request failed");
  res.status(500).json({ error: "The workspace could not complete this request. Please try again." });
});

export default app;
