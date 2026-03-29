import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { createFuturesClient } from "../auth/futures.ts";
import { getSince, getCount } from "../utils/kraken-helpers.ts";
import { buildFuturesTransactions } from "../utils/futures-transaction-builder.ts";
import { buildFuturesPositionsHTML } from "../views/positions-view.ts";
import { buildFuturesTransactionsHTML } from "../views/transactions-view.ts";

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createFuturesRouter() {
  const router = Router();
  const client = createFuturesClient({
    publicKey: process.env.KRAKEN_FUTURES_PUBLIC_KEY!,
    privateKey: process.env.KRAKEN_FUTURES_PRIVATE_KEY!,
  });

  router.get("/balances", wrap(async (req, res) => {
    const data = await client.request("/derivatives/api/v3/accounts");
    if (data.result !== "success") { res.status(400).json(data); return; }

    const accounts = data.accounts;
    const result: Record<string, unknown> = {};

    if (accounts.flex) {
      const f = accounts.flex;
      const currencies: Record<string, unknown> = {};
      for (const [cur, info] of Object.entries(f.currencies || {})) {
        if ((info as any).quantity > 0) {
          currencies[cur] = { quantity: (info as any).quantity, valueUsd: (info as any).value, collateral: (info as any).collateral, available: (info as any).available };
        }
      }
      result.flex = { currencies, portfolioValue: f.portfolioValue, availableMargin: f.availableMargin, initialMargin: f.initialMargin, pnl: f.pnl, unrealizedFunding: f.unrealizedFunding };
    }

    if (accounts.cash) {
      const nonZero: Record<string, number> = {};
      for (const [cur, val] of Object.entries(accounts.cash.balances || {})) {
        if (val > 0) nonZero[cur] = val;
      }
      if (Object.keys(nonZero).length > 0) result.cash = nonZero;
    }
    res.json({ balances: result });
  }));

  router.get("/positions", wrap(async (req, res) => {
    const since = getSince(req);
    const count = getCount(req, 50);
    const data = await client.request(
      `/api/history/v3/positions?since=${since}&count=${count}&sort=desc&closed=true&decreased=true&reversed=true`,
      { postDataInSign: true },
    );
    res.json(data);
  }));

  router.get("/transactions", wrap(async (req, res) => {
    const since = getSince(req);
    const count = getCount(req, 5000);
    const data = await client.request(
      `/api/history/v3/account-log?since=${since}&count=${count}&sort=desc`,
      { postDataInSign: true },
    );
    const transactions = buildFuturesTransactions(data.logs || []);
    res.json({ count: transactions.length, transactions });
  }));

  router.get("/positions/view", wrap(async (req, res) => {
    const since = getSince(req);
    const count = getCount(req, 50);
    const data = await client.request(
      `/api/history/v3/positions?since=${since}&count=${count}&sort=desc&closed=true&decreased=true&reversed=true`,
      { postDataInSign: true },
    );
    res.type("html").send(buildFuturesPositionsHTML(data.elements || []));
  }));

  router.get("/transactions/view", wrap(async (req, res) => {
    const since = getSince(req);
    const count = getCount(req, 5000);
    const data = await client.request(
      `/api/history/v3/account-log?since=${since}&count=${count}&sort=desc`,
      { postDataInSign: true },
    );
    const transactions = buildFuturesTransactions(data.logs || []);
    res.type("html").send(buildFuturesTransactionsHTML(transactions));
  }));

  return router;
}
