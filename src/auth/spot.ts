import crypto from "crypto";
import { sleep } from "../utils/kraken-helpers.ts";
import { logger } from "../utils/logger.ts";
import type { SpotTrade, SpotLedgerEntry } from "../types/kraken.ts";

const SPOT_BASE_URL = "https://api.kraken.com";

export interface SpotClientConfig {
  apiKey: string;
  apiSecret: string;
}

let lastNonce = 0n;

function getNonce(): string {
  const now = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  lastNonce = now > lastNonce ? now : lastNonce + 1n;
  return lastNonce.toString();
}

function signSpotRequest(secret: string, path: string, postData: string, nonce: string): string {
  const message = nonce + postData;
  const hash = crypto.createHash("sha256").update(message, "utf8").digest();
  const secretBuf = Buffer.from(secret, "base64");
  return crypto.createHmac("sha512", secretBuf).update(Buffer.concat([Buffer.from(path), hash])).digest("base64");
}

export function createSpotClient({ apiKey, apiSecret }: SpotClientConfig) {
  async function request(path: string, params: Record<string, string | number> = {}, retries = 5): Promise<any> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const nonce = getNonce();
      const body = new URLSearchParams({ nonce, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString();
      const sign = signSpotRequest(apiSecret, path, body, nonce);

      const res = await fetch(`${SPOT_BASE_URL}${path}`, {
        method: "POST",
        headers: { "API-Key": apiKey, "API-Sign": sign, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kraken Spot API ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (data.error?.length > 0) {
        const isRateLimit = data.error.some((e: string) => e.includes("Rate limit"));
        if (isRateLimit && attempt < retries) {
          logger.warn({ attempt: attempt + 1, retries, waitSeconds: (attempt + 1) * 15 }, "Kraken rate limited, retrying");
          await sleep((attempt + 1) * 15000);
          continue;
        }
        throw new Error(`Kraken Spot: ${data.error.join(", ")}`);
      }
      return data.result;
    }
  }

  async function fetchAllLedgers(params: Record<string, string | number> = {}): Promise<Record<string, SpotLedgerEntry>> {
    const all: Record<string, SpotLedgerEntry> = {};
    let offset = 0;
    while (true) {
      const result = await request("/0/private/Ledgers", { ...params, ofs: offset });
      const entries = Object.entries(result.ledger || {});
      if (entries.length === 0) break;
      for (const [id, entry] of entries) all[id] = entry as SpotLedgerEntry;
      offset += 50;
      if (offset >= result.count) break;
      await sleep(3000);
    }
    return all;
  }

  async function fetchAllTrades(params: Record<string, string | number> = {}): Promise<Record<string, SpotTrade>> {
    const all: Record<string, SpotTrade> = {};
    let offset = 0;
    while (true) {
      const result = await request("/0/private/TradesHistory", { ...params, ofs: offset });
      const entries = Object.entries(result.trades || {});
      if (entries.length === 0) break;
      for (const [id, trade] of entries) all[id] = { ...(trade as SpotTrade), txid: id };
      offset += 50;
      if (offset >= result.count) break;
      await sleep(3000);
    }
    return all;
  }

  return { request, fetchAllLedgers, fetchAllTrades };
}
