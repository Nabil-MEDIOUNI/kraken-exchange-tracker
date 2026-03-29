import "dotenv/config";
import express from "express";
import { requireAuth } from "./middleware/auth.ts";
import { requestLogger } from "./middleware/logging.ts";
import { createFuturesRouter } from "./routes/futures.ts";
import { createSpotRouter } from "./routes/spot.ts";
import { refreshEurUsdRate } from "./views/view-utils.ts";
import { logger } from "./utils/logger.ts";
import type { Request, Response, NextFunction } from "express";
const REQUIRED_ENV = ["KRAKEN_FUTURES_PUBLIC_KEY", "KRAKEN_FUTURES_PRIVATE_KEY", "KRAKEN_SPOT_API_KEY", "KRAKEN_SPOT_API_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ key }, "Missing required env var");
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(requireAuth);
app.use(requestLogger);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use("/futures", createFuturesRouter());
app.use("/spots", createSpotRouter());

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, path: req.path }, "Request failed");
  const status = err.statusCode || 500;
  const message = process.env.NODE_ENV === "production" && status === 500 ? "Internal server error" : err.message;
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, async () => {
  await refreshEurUsdRate();
  logger.info({ port: PORT }, "Kraken API started");
  logger.info("Futures: GET /balances, /positions, /transactions");
  logger.info("Spot:    GET /spot/balances, /spot/positions, /spot/transactions");
  logger.info("Views:   GET /positions/view, /transactions/view, /spot/positions/view, /spot/transactions/view");
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
