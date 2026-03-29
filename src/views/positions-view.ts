import type { NormalizedPosition } from "../types/common.ts";
import type { PositionElement } from "../types/kraken.ts";
import { formatDateTime, formatPriceWithCurrency, formatPrice, formatQuantity, iconFor, currencySymbol, wrapTablePage } from "./view-utils.ts";

interface ColumnDef<T> {
  header: string;
  align?: "left" | "right";
  render: (item: T) => string;
}

interface PositionViewConfig<T> {
  title: string;
  extraStyles?: string;
  columns: ColumnDef<T>[];
}

function buildTableHTML<T>(items: T[], config: PositionViewConfig<T>): string {
  const headersHTML = config.columns
    .map((col) => '<th' + (col.align === "right" ? ' style="text-align:right"' : '') + '>' + col.header + '</th>')
    .join("");

  const rowsHTML = items.map((item) =>
    '<tr>' + config.columns.map((col) => '<td' + (col.align === "right" ? ' style="text-align:right"' : '') + '>' + col.render(item) + '</td>').join("") + '</tr>'
  ).join("");

  return wrapTablePage(config.title, headersHTML, rowsHTML, config.extraStyles);
}

const ICON_CLASSES: Record<string, string> = { btc: "icon-btc", eth: "icon-eth", sol: "icon-sol", doge: "icon-doge", pepe: "icon-pepe" };

const FUTURES_ICON_STYLES = `
  .icon-btc { background: #f7931a; } .icon-eth { background: #627eea; }
  .icon-sol { background: #9945ff; } .icon-doge { background: #c2a633; }
  .icon-pepe { background: #4a8c3f; } .icon-default { background: #555; }
`;

function pnlCell(pnl: number, pnlPct: number, currency: string): string {
  const cls = pnl >= 0 ? "pnl-positive" : "pnl-negative";
  const sign = pnl >= 0 ? "+" : "";
  return '<div class="pnl-cell ' + cls + '"><span class="pnl-value">' + sign + pnl.toFixed(2) + ' ' + currency + '</span><span class="pnl-pct">' + sign + pnlPct.toFixed(2) + '%</span></div>';
}

function parsePositionUpdate(element: PositionElement): NormalizedPosition | null {
  const update = element.event?.PositionUpdate;
  if (!update) return null;

  const tradeable = update.tradeable || "";
  const symbol = tradeable.replace(/^PF_/, "").replace(/USD$/, "");
  const openPrice = parseFloat(update.oldAverageEntryPrice);
  const qty = parseFloat(update.executionSize);
  const pnl = parseFloat(update.realizedPnL);
  const costBasis = openPrice * qty;

  return {
    id: (update.executionUid || "").slice(0, 8),
    positionOpened: (update.fillTime ? new Date(update.fillTime) : new Date(element.timestamp)).toISOString(),
    positionClosed: new Date(element.timestamp).toISOString(),
    side: parseFloat(update.oldPosition) < 0 ? "Short" : "Long",
    market: symbol + " Perp", base: symbol, symbol,
    openingPrice: openPrice,
    closingPrice: parseFloat(update.executionPrice),
    quantity: qty,
    pnl, pnlPct: costBasis > 0 ? (pnl / costBasis) * 100 : 0,
    currency: (update.feeCurrency || "USD").toUpperCase(),
    feeCurrency: (update.feeCurrency || "USD").toUpperCase(),
  };
}

const futuresColumns: ColumnDef<NormalizedPosition>[] = [
  { header: "Position Opened", render: (p) => formatDateTime(p.positionOpened) },
  { header: "Position Closed", render: (p) => formatDateTime(p.positionClosed) },
  { header: "Side", render: (p) => '<span class="' + (p.side === "Short" ? "side-short" : "side-long") + '">' + p.side + '</span>' },
  { header: "Market", render: (p) => { const sym = p.symbol.toLowerCase(); const cls = ICON_CLASSES[sym] || "icon-default"; return '<div class="market-cell"><span class="market-icon ' + cls + '">' + p.symbol[0] + '</span>' + p.market + '</div>'; } },
  { header: "Opening Price", align: "right", render: (p) => formatPriceWithCurrency(p.openingPrice, p.feeCurrency) },
  { header: "Quantity", align: "right", render: (p) => formatQuantity(p.quantity, p.symbol) },
  { header: "Closing Price", align: "right", render: (p) => formatPriceWithCurrency(p.closingPrice, p.feeCurrency) },
  { header: "P&amp;L", align: "right", render: (p) => pnlCell(p.pnl, p.pnlPct, p.feeCurrency) },
  { header: "ID", align: "right", render: (p) => '<span class="id-cell">' + p.id + '</span>' },
];

export function buildFuturesPositionsHTML(elements: PositionElement[]): string {
  const positions = elements.map(parsePositionUpdate).filter((p): p is NormalizedPosition => p !== null);
  return buildTableHTML(positions, { title: "Derivatives Positions History", columns: futuresColumns, extraStyles: FUTURES_ICON_STYLES });
}

const spotColumns: ColumnDef<NormalizedPosition>[] = [
  { header: "Position Opened", render: (p) => formatDateTime(p.positionOpened) },
  { header: "Position Closed", render: (p) => formatDateTime(p.positionClosed) },
  { header: "Side", render: (p) => '<span class="' + (p.side === "Short" ? "side-short" : "side-long") + '">' + p.side + '</span>' },
  { header: "Market", render: (p) => { const icon = iconFor(p.base); return '<div class="market-cell"><span class="market-icon" style="background:' + icon.bg + '">' + icon.letter + '</span>' + p.market + '</div>'; } },
  { header: "Opening Price", align: "right", render: (p) => formatPrice(p.openingPrice) + ' <span class="currency">' + currencySymbol(p.currency) + '</span>' },
  { header: "Quantity", align: "right", render: (p) => formatQuantity(p.quantity, p.base) },
  { header: "Closing Price", align: "right", render: (p) => formatPrice(p.closingPrice) + ' <span class="currency">' + currencySymbol(p.currency) + '</span>' },
  { header: "Leverage", align: "right", render: (p) => '<span class="leverage-badge">' + (p.leverage || "0") + 'x</span>' },
  { header: "P&amp;L", align: "right", render: (p) => pnlCell(p.pnl, p.pnlPct, currencySymbol(p.currency)) },
  { header: "ID", align: "right", render: (p) => '<span class="id-cell">' + p.id.slice(0, 10) + '</span>' },
];

export function buildSpotPositionsHTML(positions: NormalizedPosition[]): string {
  return buildTableHTML(positions, { title: "Spot Margin Positions History", columns: spotColumns });
}
