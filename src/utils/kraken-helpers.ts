import type { Request } from "express";

const ASSET_MAP: Record<string, string> = {
  ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP", ZJPY: "JPY", ZCAD: "CAD", ZAUD: "AUD",
  XXBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC", XXLM: "XLM", XDOGE: "DOGE",
  XXMR: "XMR", XZEC: "ZEC", XETC: "ETC", XREP: "REP", XMLN: "MLN",
};

const FIAT_SUFFIXES = ["ZEUR", "ZUSD", "ZGBP", "ZJPY", "ZCAD", "ZAUD", "EUR", "USD", "GBP", "JPY", "CAD", "AUD"];
const CRYPTO_QUOTES = ["XBT", "XXBT", "ETH", "XETH"];

export function normalizeAsset(asset: string): string {
  return ASSET_MAP[asset] || asset;
}

export function parsePair(pair: string): { base: string; quote: string } {
  for (const suffix of FIAT_SUFFIXES) {
    if (pair.endsWith(suffix)) {
      return { base: normalizeAsset(pair.slice(0, -suffix.length)), quote: normalizeAsset(suffix) };
    }
  }
  for (const q of CRYPTO_QUOTES) {
    if (pair.endsWith(q) && pair.length > q.length) {
      return { base: normalizeAsset(pair.slice(0, -q.length)), quote: normalizeAsset(q) };
    }
  }
  return { base: pair, quote: "UNKNOWN" };
}

class ValidationError extends Error {
  statusCode = 400;
}

export function getSince(req: Request): number {
  const raw = req.query.since;
  if (raw) {
    const parsed = Number(raw);
    if (isNaN(parsed) || parsed < 0) throw new ValidationError("Invalid 'since' parameter");
    return parsed;
  }
  return Date.now() - 180 * 24 * 60 * 60 * 1000;
}

export function getCount(req: Request, defaultCount: number): number {
  const raw = req.query.count;
  if (raw) {
    const parsed = Number(raw);
    if (isNaN(parsed) || parsed < 1 || parsed > 10000) throw new ValidationError("Invalid 'count' parameter (1-10000)");
    return parsed;
  }
  return defaultCount;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
