import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createFuturesClient } from "./auth/futures.ts";
import { createSpotClient } from "./auth/spot.ts";
import { normalizeAsset, parsePair, sleep } from "./utils/kraken-helpers.ts";
import { buildFuturesTransactions } from "./utils/futures-transaction-builder.ts";
import { buildSpotTransactions } from "./utils/spot-transaction-builder.ts";
import { buildGermanTaxReport, formatTaxReportSummary } from "./utils/german-tax-report.ts";
import { TTLCache } from "./utils/cache.ts";
import type { NormalizedPosition, SpotTransaction, FuturesTransaction } from "./types/common.ts";
import type { SpotTrade } from "./types/kraken.ts";

// --- Validate env ---
const REQUIRED_ENV = [
  "KRAKEN_FUTURES_PUBLIC_KEY",
  "KRAKEN_FUTURES_PRIVATE_KEY",
  "KRAKEN_SPOT_API_KEY",
  "KRAKEN_SPOT_API_SECRET",
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`ERROR: Missing required env var: ${key}`);
    process.exit(1);
  }
}

// --- Kraken clients ---
const futuresClient = createFuturesClient({
  publicKey: process.env.KRAKEN_FUTURES_PUBLIC_KEY!,
  privateKey: process.env.KRAKEN_FUTURES_PRIVATE_KEY!,
});

const spotClient = createSpotClient({
  apiKey: process.env.KRAKEN_SPOT_API_KEY!,
  apiSecret: process.env.KRAKEN_SPOT_API_SECRET!,
});

// --- Caches (reuse same TTL as the Express app) ---
const positionsCache = new TTLCache<NormalizedPosition[]>(5 * 60 * 1000);
const transactionsCache = new TTLCache<SpotTransaction[]>(5 * 60 * 1000);

// --- Progress logging (MCP uses stdio, so progress goes to stderr) ---
function mcpLog(message: string): void {
  console.error(`[kraken-portfolio] ${message}`);
}

// --- Shared helpers ---
function defaultSince(): number {
  return Date.now() - 180 * 24 * 60 * 60 * 1000;
}

function buildSpotPositionsList(tradeList: SpotTrade[]): NormalizedPosition[] {
  const openers = tradeList.filter(
    (t) => t.posstatus === "closed" && parseFloat(t.margin || "0") > 0,
  );
  const positions: NormalizedPosition[] = [];

  for (const opener of openers) {
    const closingTrades = tradeList.filter(
      (t) => t.postxid === opener.txid && (t.misc || "").includes("closing"),
    );
    const isShort = opener.type === "sell";
    const openPrice = parseFloat(opener.price);
    const openVol = parseFloat(opener.vol);
    const openCost = parseFloat(opener.cost);
    const openFee = parseFloat(opener.fee);

    let closeVol = 0,
      closeCost = 0,
      closeFee = 0;
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
    const pnl = isShort
      ? openCost - closeCost - totalFee
      : closeCost - openCost - totalFee;
    const pnlPct = openCost > 0 ? (pnl / openCost) * 100 : 0;
    const { base, quote } = parsePair(
      (opener.pair || "").replace("/", ""),
    );

    positions.push({
      id: opener.txid || "",
      positionOpened: new Date(parseFloat(String(opener.time)) * 1000).toISOString(),
      positionClosed: new Date(closeTime * 1000).toISOString(),
      side: isShort ? "Short" : "Long",
      market: base + "/" + quote,
      base,
      symbol: base,
      openingPrice: openPrice,
      closingPrice: +closePrice.toFixed(8),
      quantity: openVol,
      leverage: opener.leverage || "0",
      pnl: +pnl.toFixed(4),
      pnlPct: +pnlPct.toFixed(2),
      currency: quote,
      feeCurrency: quote,
    });
  }

  positions.sort(
    (a, b) =>
      new Date(b.positionOpened).getTime() -
      new Date(a.positionOpened).getTime(),
  );
  return positions;
}

async function fetchSpotPositions(): Promise<NormalizedPosition[]> {
  const cached = positionsCache.get("positions");
  if (cached) {
    mcpLog("Returning cached spot positions");
    return cached;
  }
  mcpLog("Fetching spot positions from Kraken...");
  const allTrades = await spotClient.fetchAllTrades({}, mcpLog);
  const positions = buildSpotPositionsList(Object.values(allTrades));
  positionsCache.set("positions", positions);
  mcpLog(`Spot positions ready: ${positions.length} positions`);
  return positions;
}

async function fetchSpotTransactions(): Promise<SpotTransaction[]> {
  const cached = transactionsCache.get("transactions");
  if (cached) {
    mcpLog("Returning cached spot transactions");
    return cached;
  }
  mcpLog("Fetching spot transactions (this may take ~30s due to Kraken rate limits)...");
  const ledgers = await spotClient.fetchAllLedgers({}, mcpLog);
  await sleep(3000);
  const trades = await spotClient.fetchAllTrades({}, mcpLog);
  mcpLog("Building transaction history with FIFO cost basis...");
  const transactions = await buildSpotTransactions(ledgers, trades, {
    normalizeAsset,
    parsePair,
  });
  transactionsCache.set("transactions", transactions);
  mcpLog(`Spot transactions ready: ${transactions.length} transactions`);
  return transactions;
}

function handleError(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const message =
    error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// --- MCP Server ---
const server = new McpServer({
  name: "kraken-portfolio-mcp",
  version: "1.0.0",
});

// --- Schemas ---
const SinceCountSchema = {
  since: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Unix timestamp in milliseconds. Defaults to 180 days ago.",
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .optional()
    .describe("Maximum number of results to return"),
};

// ===== FUTURES TOOLS =====

server.registerTool(
  "kraken_tracker_futures_balances",
  {
    title: "Get Futures Balances",
    description: `Get Kraken Futures account balances including Flex and Cash accounts.

Returns portfolio value, available margin, initial margin, unrealized P&L, and per-currency balances with USD values.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      mcpLog("Fetching futures balances...");
      const data = await futuresClient.request(
        "/derivatives/api/v3/accounts",
      );
      if (data.result !== "success") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Kraken API error: ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      const accounts = data.accounts;
      const result: Record<string, unknown> = {};

      if (accounts.flex) {
        const f = accounts.flex;
        const currencies: Record<string, unknown> = {};
        for (const [cur, info] of Object.entries(f.currencies || {})) {
          if ((info as any).quantity > 0) {
            currencies[cur] = {
              quantity: (info as any).quantity,
              valueUsd: (info as any).value,
              collateral: (info as any).collateral,
              available: (info as any).available,
            };
          }
        }
        result.flex = {
          currencies,
          portfolioValue: f.portfolioValue,
          availableMargin: f.availableMargin,
          initialMargin: f.initialMargin,
          pnl: f.pnl,
          unrealizedFunding: f.unrealizedFunding,
        };
      }

      if (accounts.cash) {
        const nonZero: Record<string, number> = {};
        for (const [cur, val] of Object.entries(
          accounts.cash.balances || {},
        )) {
          if ((val as number) > 0) nonZero[cur] = val as number;
        }
        if (Object.keys(nonZero).length > 0) result.cash = nonZero;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ balances: result }, null, 2),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "kraken_tracker_futures_positions",
  {
    title: "Get Futures Positions",
    description: `Get closed/reversed Kraken Futures positions with P&L data.

Returns position history including open/close prices, side (long/short), realized P&L, and fees. Sorted by most recent first.

Args:
  - since (number, optional): Unix timestamp in ms. Defaults to 180 days ago.
  - count (number, optional): Max results, 1-10000. Defaults to 50.`,
    inputSchema: SinceCountSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ since, count }) => {
    try {
      const s = since ?? defaultSince();
      const c = count ?? 50;
      mcpLog(`Fetching futures positions (since: ${new Date(s).toISOString()}, count: ${c})...`);
      const data = await futuresClient.request(
        `/api/history/v3/positions?since=${s}&count=${c}&sort=desc&closed=true&decreased=true&reversed=true`,
        { postDataInSign: true },
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(data, null, 2) },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "kraken_tracker_futures_transactions",
  {
    title: "Get Futures Transactions",
    description: `Get Kraken Futures transaction history: realized P&L, funding fees, deposits, and withdrawals.

Trades are grouped by date and contract. Funding fees are aggregated between trades. Returns amount, fee, and realized P&L per transaction.

Args:
  - since (number, optional): Unix timestamp in ms. Defaults to 180 days ago.
  - count (number, optional): Max results, 1-10000. Defaults to 5000.`,
    inputSchema: SinceCountSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ since, count }) => {
    try {
      const s = since ?? defaultSince();
      const c = count ?? 5000;
      mcpLog(`Fetching futures transactions (since: ${new Date(s).toISOString()}, count: ${c})...`);
      const data = await futuresClient.request(
        `/api/history/v3/account-log?since=${s}&count=${c}&sort=desc`,
        { postDataInSign: true },
      );
      const transactions = buildFuturesTransactions(data.logs || []);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: transactions.length, transactions },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

// ===== SPOT TOOLS =====

server.registerTool(
  "kraken_tracker_spot_balances",
  {
    title: "Get Spot Balances",
    description: `Get Kraken Spot account balances.

Returns all non-zero asset balances with normalized asset names (e.g., XXBT -> BTC, ZEUR -> EUR).`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      mcpLog("Fetching spot balances...");
      const balances = await spotClient.request("/0/private/Balance");
      const result: Record<string, number> = {};
      for (const [asset, amount] of Object.entries(balances)) {
        const val = parseFloat(amount as string);
        if (val > 0) result[normalizeAsset(asset)] = val;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ balances: result }, null, 2),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "kraken_tracker_spot_positions",
  {
    title: "Get Spot Positions",
    description: `Get Kraken Spot margin position history with P&L.

Returns closed margin positions with opening/closing prices, side (Long/Short), leverage, realized P&L, and P&L percentage. Uses FIFO cost basis. Sorted by most recent first.

Args:
  - since (string, optional): ISO date string (e.g. "2025-01-01"). Only return positions opened after this date.
  - count (number, optional): Maximum number of positions to return.`,
    inputSchema: {
      since: z
        .string()
        .optional()
        .describe(
          "ISO date string (e.g. '2025-01-01'). Only return positions opened after this date.",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of positions to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ since, count }) => {
    try {
      let positions = await fetchSpotPositions();
      if (since) {
        const sinceMs = new Date(since).getTime();
        positions = positions.filter(
          (p) => new Date(p.positionOpened).getTime() >= sinceMs,
        );
      }
      if (count) {
        positions = positions.slice(0, count);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: positions.length, positions },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

server.registerTool(
  "kraken_tracker_spot_transactions",
  {
    title: "Get Spot Transactions",
    description: `Get Kraken Spot transaction history with FIFO cost basis (Koinly-compatible).

Returns all spot transactions including buys, sells, deposits, withdrawals, and staking. Each trade includes from/to amounts, fees, net value, and realized gain/loss. Uses FIFO lot tracking for cost basis calculation.

Note: First call may be slow (~30s) due to Kraken API rate limits when fetching full history. Results are cached for 5 minutes. Progress updates are logged to stderr.

Args:
  - since (string, optional): ISO date string (e.g. "2025-01-01"). Only return transactions after this date.
  - count (number, optional): Maximum number of transactions to return.`,
    inputSchema: {
      since: z
        .string()
        .optional()
        .describe(
          "ISO date string (e.g. '2025-01-01'). Only return transactions after this date.",
        ),
      count: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of transactions to return"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ since, count }) => {
    try {
      let transactions = await fetchSpotTransactions();
      if (since) {
        const sinceMs = new Date(since).getTime();
        transactions = transactions.filter(
          (t) => new Date(t.date).getTime() >= sinceMs,
        );
      }
      if (count) {
        transactions = transactions.slice(0, count);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { count: transactions.length, transactions },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

// ===== PORTFOLIO SUMMARY TOOL =====

server.registerTool(
  "kraken_tracker_portfolio_summary",
  {
    title: "Get Portfolio Summary",
    description: `Get a combined overview of your entire Kraken portfolio.

Returns futures balances (portfolio value, margin, P&L), spot balances (all non-zero assets), and recent futures position count. Useful for a quick snapshot of your full portfolio state.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      mcpLog("Fetching portfolio summary (futures + spot balances)...");
      const [futuresData, spotBalancesRaw] = await Promise.all([
        futuresClient.request("/derivatives/api/v3/accounts"),
        spotClient.request("/0/private/Balance"),
      ]);

      const summary: Record<string, unknown> = {};

      // Futures summary
      if (futuresData.result === "success" && futuresData.accounts?.flex) {
        const f = futuresData.accounts.flex;
        summary.futures = {
          portfolioValue: f.portfolioValue,
          availableMargin: f.availableMargin,
          initialMargin: f.initialMargin,
          pnl: f.pnl,
          unrealizedFunding: f.unrealizedFunding,
        };
      }

      // Spot balances
      const spotBalances: Record<string, number> = {};
      for (const [asset, amount] of Object.entries(spotBalancesRaw)) {
        const val = parseFloat(amount as string);
        if (val > 0) spotBalances[normalizeAsset(asset)] = val;
      }
      summary.spot = { balances: spotBalances };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

// ===== EUR/USD RATE (for tax report) =====

let cachedEurUsdRate = 1.155;
let rateLastFetched = 0;

async function refreshEurUsdRate(): Promise<number> {
  if (Date.now() - rateLastFetched < 10 * 60 * 1000) return cachedEurUsdRate;
  try {
    const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=EURUSD");
    const data = await res.json();
    const ticker = data.result?.EURUSD || data.result?.ZEURZUSD;
    if (ticker) {
      cachedEurUsdRate = parseFloat(ticker.c[0]);
      rateLastFetched = Date.now();
    }
  } catch { /* keep fallback */ }
  return cachedEurUsdRate;
}

// ===== GERMAN TAX REPORT TOOL =====

async function fetchFuturesTransactions(since: number, count: number): Promise<FuturesTransaction[]> {
  const data = await futuresClient.request(
    `/api/history/v3/account-log?since=${since}&count=${count}&sort=desc`,
    { postDataInSign: true },
  );
  return buildFuturesTransactions(data.logs || []);
}

server.registerTool(
  "kraken_tracker_german_tax_report",
  {
    title: "German Crypto Tax Report",
    description: `Generate a complete German crypto tax report (Steuerbericht) for a given year.

Fetches all spot transactions, margin positions, and futures data, then classifies everything under German tax law:
- § 23 EStG: Spot sells (FIFO cost basis), margin positions, loan fees
- § 22 Nr. 3 EStG: Staking rewards
- § 20 EStG: Futures P&L and funding fees (USD→EUR converted)

Applies Freigrenze rules (1.000 EUR for § 23, 256 EUR for § 22 Nr. 3) and the 20.000 EUR derivative loss cap.

Returns a compact summary with totals, Elster line references, and a CSV with all individual transactions.

Args:
  - year (number, required): Tax year (e.g. 2025).`,
    inputSchema: {
      year: z
        .number()
        .int()
        .min(2020)
        .max(2030)
        .describe("Tax year (e.g. 2025)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ year }) => {
    try {
      mcpLog(`Generating German tax report for ${year}...`);

      // Fetch all data in parallel
      const yearStart = new Date(`${year}-01-01T00:00:00Z`).getTime();
      const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`).getTime();

      const [spotTxns, spotPos, futuresTxns, eurUsdRate] = await Promise.all([
        fetchSpotTransactions(),
        fetchSpotPositions(),
        fetchFuturesTransactions(yearStart, 10000),
        refreshEurUsdRate(),
      ]);

      mcpLog(`Data fetched: ${spotTxns.length} spot txns, ${spotPos.length} margin positions, ${futuresTxns.length} futures txns`);

      const report = buildGermanTaxReport({
        year,
        eurUsdRate,
        spotTransactions: spotTxns,
        spotPositions: spotPos,
        futuresTransactions: futuresTxns,
      });

      const summary = formatTaxReportSummary(report);

      mcpLog(`Tax report for ${year} complete: ${report.csv.split("\\n").length - 1} transactions in CSV`);

      return {
        content: [
          { type: "text" as const, text: summary },
          { type: "text" as const, text: "---CSV_START---\n" + report.csv + "\n---CSV_END---" },
        ],
      };
    } catch (error) {
      return handleError(error);
    }
  },
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kraken Portfolio MCP server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
