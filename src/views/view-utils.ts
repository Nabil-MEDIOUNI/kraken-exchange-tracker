import type { CoinIcon } from "../types/common.ts";

const CRYPTO_ICONS: Record<string, CoinIcon> = {
  BTC: { bg: "#f7931a", letter: "B" }, ETH: { bg: "#627eea", letter: "E" },
  SOL: { bg: "#9945ff", letter: "S" }, DOGE: { bg: "#c2a633", letter: "D" },
  PEPE: { bg: "#4a8c3f", letter: "P" }, XRP: { bg: "#23292f", letter: "X" },
  ADA: { bg: "#0033ad", letter: "A" }, DOT: { bg: "#e6007a", letter: "D" },
  LTC: { bg: "#bfbbbb", letter: "L" }, ALGO: { bg: "#000", letter: "A" },
};

const CURRENCY_ICONS: Record<string, CoinIcon> = {
  EUR: { bg: "#003399", letter: "\u20AC" },
  USD: { bg: "#2d6a2e", letter: "$" },
};

export function iconFor(symbol: string | null): CoinIcon {
  if (!symbol) return { bg: "#555", letter: "?" };
  return CRYPTO_ICONS[symbol] || CURRENCY_ICONS[symbol] || { bg: "#555", letter: symbol[0] };
}

export function currencySymbol(currency: string): string {
  if (currency === "EUR") return "\u20AC";
  if (currency === "USD") return "$";
  return currency;
}

export function formatDateTime(dateOrString: Date | string | number): string {
  const d = dateOrString instanceof Date ? dateOrString : new Date(dateOrString);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatDateShort(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

export function formatPrice(price: number): string {
  if (price < 0.0001) return price.toFixed(12);
  if (price < 0.001) return price.toFixed(10);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPriceWithCurrency(price: number, currency: string): string {
  if (price < 0.001) return price.toFixed(10) + " " + currency;
  if (price < 1) return price.toFixed(2) + " " + currency;
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + currency;
}

export function formatQuantity(quantity: number, symbol: string): string {
  if (quantity >= 1000) return quantity.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " " + symbol;
  if (quantity >= 1) return quantity.toFixed(2) + " " + symbol;
  return quantity.toFixed(4) + " " + symbol;
}

export function formatAbsoluteAmount(value: string | number): string {
  const absolute = Math.abs(typeof value === "string" ? parseFloat(value) : value);
  if (absolute >= 1000000) return absolute.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (absolute >= 1) return absolute.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (absolute >= 0.01) return absolute.toFixed(4);
  return absolute.toFixed(8);
}

export function coinIconHTML(icon: CoinIcon, extraClass?: string): string {
  const cls = extraClass ? "coin-icon " + extraClass : "coin-icon";
  return '<span class="' + cls + '" style="background:' + icon.bg + '">' + icon.letter + "</span>";
}

export function arrowFlowHTML(left: CoinIcon, right: CoinIcon): string {
  return '<div class="middle-icons">' +
    coinIconHTML(left) + '<span class="arrow-icon">\u279C</span>' + coinIconHTML(right) +
    "</div>";
}

let cachedEurUsdRate = 1.155;
let rateLastFetched = 0;

export async function refreshEurUsdRate(): Promise<void> {
  if (Date.now() - rateLastFetched < 10 * 60 * 1000) return;
  try {
    const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=EURUSD");
    const data = await res.json();
    const ticker = data.result?.EURUSD || data.result?.ZEURZUSD;
    if (ticker) { cachedEurUsdRate = parseFloat(ticker.c[0]); rateLastFetched = Date.now(); }
  } catch { /* keep fallback */ }
}

export function convertToEur(amount: number, currency: string): number | null {
  if (currency === "EUR") return amount;
  if (currency === "USD") return amount * cachedEurUsdRate;
  return null;
}

export function formatEurAmount(value: number | null): string | null {
  if (value === null) return null;
  if (Math.abs(value) < 0.01) return value.toFixed(4).replace(".", ",") + " \u20AC";
  return value.toFixed(2).replace(".", ",") + " \u20AC";
}

export function groupByDate<T>(items: T[], dateField: keyof T): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items) {
    const key = formatDateShort(item[dateField] as string);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  return grouped;
}

export const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0b0e11; color: #eaecef; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  .side-short { color: #f6465d; } .side-long { color: #0ecb81; }
  .pnl-positive { color: #0ecb81; } .pnl-negative { color: #f6465d; }
  .positive { color: #0ecb81; } .negative { color: #f6465d; }
`;

export const TABLE_STYLES = `
  .table-container { width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 1100px; }
  thead th { position: sticky; top: 0; background: #0b0e11; color: #848e9c; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; padding: 10px 12px; text-align: left; border-bottom: 1px solid #1e2329; white-space: nowrap; z-index: 1; }
  tbody tr { border-bottom: 1px solid rgba(30, 35, 41, 0.5); transition: background 0.15s; }
  tbody tr:hover { background: rgba(30, 35, 41, 0.6); }
  td { padding: 8px 12px; white-space: nowrap; vertical-align: middle; font-size: 12px; color: #eaecef; }
  .market-cell { display: flex; align-items: center; gap: 6px; }
  .market-icon { width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 700; color: #fff; flex-shrink: 0; }
  .currency { color: #848e9c; font-size: 11px; margin-left: 2px; }
  .num { text-align: right; }
  .pnl-cell { display: flex; flex-direction: column; line-height: 1.3; }
  .pnl-value { font-weight: 500; } .pnl-pct { font-size: 11px; }
  .id-cell { color: #848e9c; font-family: 'SF Mono', 'Consolas', 'Courier New', monospace; font-size: 11px; text-align: right; }
  th:last-child, td:last-child { text-align: right; }
  .leverage-badge { background: rgba(255,255,255,0.06); border-radius: 3px; padding: 1px 6px; font-size: 11px; color: #848e9c; }
`;

export const CARD_STYLES = `
  .container { max-width: 1110px; margin: 0 auto; padding: 16px 0; }
  .date-group { padding: 8px 24px; }
  .date-label { color: #848e9c; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
  .row { display: flex; align-items: center; padding: 10px 24px; min-height: 64px; border-bottom: 1px solid rgba(30, 35, 41, 0.6); transition: background 0.15s; }
  .row.tall { min-height: 88px; } .row:hover { background: rgba(30, 35, 41, 0.5); }
  .left { display: flex; align-items: center; gap: 12px; min-width: 180px; }
  .kraken-logo { width: 30px; height: 30px; border-radius: 50%; background: #5741d9; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; flex-shrink: 0; }
  .left-text { display: flex; flex-direction: column; gap: 1px; }
  .tx-type { font-size: 13px; font-weight: 500; color: #eaecef; background: rgba(255,255,255,0.06); border-radius: 4px; padding: 2px 8px; display: inline-block; white-space: nowrap; }
  .tx-type.positive { color: #0ecb81; background: rgba(14,203,129,0.1); }
  .tx-type.negative { color: #f6465d; background: rgba(246,70,93,0.1); }
  .tx-time { font-size: 11px; color: #848e9c; padding-left: 2px; }
  .middle { flex: 1; display: flex; align-items: center; justify-content: center; min-width: 200px; }
  .middle-icons { display: flex; align-items: center; gap: 8px; }
  .coin-icon { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; flex-shrink: 0; }
  .kraken-icon { background: #5741d9; }
  .arrow-icon { color: #848e9c; font-size: 16px; }
  .right { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px; min-width: 300px; position: relative; padding-right: 120px; }
  .wallet-label { width: 100%; font-size: 11px; color: #848e9c; }
  .amount-line { display: flex; align-items: baseline; gap: 2px; }
  .sign, .amount-value { font-size: 14px; font-weight: 500; }
  .eur-equiv { font-size: 11px; color: #848e9c; background: rgba(255,255,255,0.04); border-radius: 3px; padding: 0 4px; }
  .pnl-dot { font-size: 11px; color: #848e9c; }
  .fee-label { font-size: 11px; color: #848e9c; background: rgba(255,255,255,0.04); border-radius: 3px; padding: 0 4px; }
  .gain-label { font-size: 11px; border-radius: 3px; padding: 0 4px; background: rgba(255,255,255,0.04); }
  .tag-badge { position: absolute; right: 0; top: 50%; transform: translateY(-50%); font-size: 11px; color: #848e9c; background: rgba(255,255,255,0.06); border-radius: 10px; padding: 2px 10px; white-space: nowrap; }
`;

export function wrapTablePage(title: string, headersHTML: string, rowsHTML: string, extraStyles = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>${BASE_STYLES}${TABLE_STYLES}${extraStyles}</style></head><body><div class="table-container"><table><thead><tr>${headersHTML}</tr></thead><tbody>${rowsHTML}</tbody></table></div></body></html>`;
}

export function wrapCardPage(title: string, bodyHTML: string, extraStyles = ""): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>${BASE_STYLES}${CARD_STYLES}${extraStyles}</style></head><body><div class="container">${bodyHTML}</div></body></html>`;
}
