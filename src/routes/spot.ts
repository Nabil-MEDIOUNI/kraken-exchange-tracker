import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { createSpotClient } from "../auth/spot.ts";
import { normalizeAsset, parsePair, sleep } from "../utils/kraken-helpers.ts";
import { buildSpotTransactions } from "../utils/spot-transaction-builder.ts";
import { buildSpotPositionsHTML } from "../views/positions-view.ts";
import { buildSpotTransactionsHTML } from "../views/transactions-view.ts";
import { TTLCache } from "../utils/cache.ts";
import { logger } from "../utils/logger.ts";
import type { NormalizedPosition, SpotTransaction } from "../types/common.ts";
import type { SpotTrade } from "../types/kraken.ts";

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function buildSpotPositionsList(tradeList: SpotTrade[]): NormalizedPosition[] {
  const openers = tradeList.filter((t) => t.posstatus === "closed" && parseFloat(t.margin || "0") > 0);
  const positions: NormalizedPosition[] = [];

  for (const opener of openers) {
    const closingTrades = tradeList.filter((t) => t.postxid === opener.txid && (t.misc || "").includes("closing"));
    const isShort = opener.type === "sell";
    const openPrice = parseFloat(opener.price);
    const openVol = parseFloat(opener.vol);
    const openCost = parseFloat(opener.cost);
    const openFee = parseFloat(opener.fee);

    let closeVol = 0, closeCost = 0, closeFee = 0;
    let closeTime = parseFloat(String(opener.time));
    for (const ct of closingTrades) {
      closeVol += parseFloat(ct.vol || "0");
      closeCost += parseFloat(ct.cost || "0");
      closeFee += parseFloat(ct.fee || "0");
      const ctTime = parseFloat(String(ct.time));
      if (ctTime > closeTime) closeTime = ctTime;
    }
    const closePrice = closeVol > 0 ? closeCost / closeVol : 0;
    const totalFee = openFee + closeFee;
    const pnl = isShort ? openCost - closeCost - totalFee : closeCost - openCost - totalFee;
    const pnlPct = openCost > 0 ? (pnl / openCost) * 100 : 0;
    const { base, quote } = parsePair((opener.pair || "").replace("/", ""));

    positions.push({
      id: opener.txid || "", positionOpened: new Date(parseFloat(String(opener.time)) * 1000).toISOString(),
      positionClosed: new Date(closeTime * 1000).toISOString(),
      side: isShort ? "Short" : "Long", market: base + "/" + quote, base, symbol: base,
      openingPrice: openPrice, closingPrice: +closePrice.toFixed(8), quantity: openVol,
      leverage: opener.leverage || "0",
      pnl: +pnl.toFixed(4), pnlPct: +pnlPct.toFixed(2), currency: quote, feeCurrency: quote,
    });
  }

  positions.sort((a, b) => new Date(b.positionOpened).getTime() - new Date(a.positionOpened).getTime());
  return positions;
}

export function createSpotRouter() {
  const router = Router();
  const client = createSpotClient({
    apiKey: process.env.KRAKEN_SPOT_API_KEY!,
    apiSecret: process.env.KRAKEN_SPOT_API_SECRET!,
  });
  const positionsCache = new TTLCache<NormalizedPosition[]>(5 * 60 * 1000);
  const transactionsCache = new TTLCache<SpotTransaction[]>(5 * 60 * 1000);

  const logProgress = (msg: string) => logger.info(msg);

  async function fetchPositions(): Promise<NormalizedPosition[]> {
    const cached = positionsCache.get("positions");
    if (cached) return cached;
    logProgress("Fetching spot positions...");
    const allTrades = await client.fetchAllTrades({}, logProgress);
    const positions = buildSpotPositionsList(Object.values(allTrades));
    positionsCache.set("positions", positions);
    logProgress(`Spot positions ready: ${positions.length} positions`);
    return positions;
  }

  async function fetchTransactions(): Promise<SpotTransaction[]> {
    const cached = transactionsCache.get("transactions");
    if (cached) return cached;
    logProgress("Fetching spot transactions (this may take ~30s)...");
    const ledgers = await client.fetchAllLedgers({}, logProgress);
    await sleep(3000);
    const trades = await client.fetchAllTrades({}, logProgress);
    logProgress("Building transaction history with FIFO cost basis...");
    const transactions = await buildSpotTransactions(ledgers, trades, { normalizeAsset, parsePair });
    transactionsCache.set("transactions", transactions);
    logProgress(`Spot transactions ready: ${transactions.length} transactions`);
    return transactions;
  }

  router.get("/balances", wrap(async (req, res) => {
    const balances = await client.request("/0/private/Balance");
    const result: Record<string, number> = {};
    for (const [asset, amount] of Object.entries(balances)) {
      const val = parseFloat(amount as string);
      if (val > 0) result[normalizeAsset(asset)] = val;
    }
    res.json({ balances: result });
  }));

  router.get("/positions", wrap(async (req, res) => {
    const positions = await fetchPositions();
    res.json({ count: positions.length, positions });
  }));

  router.get("/transactions", wrap(async (req, res) => {
    const transactions = await fetchTransactions();
    res.json({ count: transactions.length, transactions });
  }));

  router.get("/positions/view", wrap(async (req, res) => {
    const positions = await fetchPositions();
    res.type("html").send(buildSpotPositionsHTML(positions));
  }));

  router.get("/transactions/view", wrap(async (req, res) => {
    const transactions = await fetchTransactions();
    res.type("html").send(buildSpotTransactionsHTML(transactions));
  }));

  return router;
}
