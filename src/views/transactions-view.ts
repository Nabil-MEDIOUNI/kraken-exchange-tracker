import type { FuturesTransaction, SpotTransaction } from "../types/common.ts";
import {
  formatTime, formatDateShort, formatAbsoluteAmount, currencySymbol,
  iconFor, arrowFlowHTML, convertToEur, formatEurAmount,
  groupByDate, wrapCardPage,
} from "./view-utils.ts";

interface TransactionViewStrategy<T> {
  title: string;
  walletName: string;
  dateField: keyof T & string;
  getLabel(tx: T): { text: string; colorClass: string };
  getMiddleIcons(tx: T): string;
  getAmountHTML(tx: T): string;
  getTagHTML(tx: T): string;
  isTallRow(tx: T): boolean;
}

function buildCardHTML<T>(transactions: T[], strategy: TransactionViewStrategy<T>): string {
  const grouped = groupByDate(transactions, strategy.dateField);
  let html = "";

  for (const [date, dayItems] of Object.entries(grouped)) {
    html += '<div class="date-group"><span class="date-label">' + date + '</span></div>';
    for (const tx of dayItems) {
      const label = strategy.getLabel(tx);
      const rowClass = strategy.isTallRow(tx) ? "row tall" : "row";
      const dateValue = tx[strategy.dateField] as string;

      html += '<div class="' + rowClass + '">' +
        '<div class="left"><span class="kraken-logo">K</span><div class="left-text">' +
          '<span class="tx-type ' + label.colorClass + '">' + label.text + '</span>' +
          '<span class="tx-time">' + formatTime(dateValue) + '</span>' +
        '</div></div>' +
        '<div class="middle">' + strategy.getMiddleIcons(tx) + '</div>' +
        '<div class="right">' + strategy.getAmountHTML(tx) + strategy.getTagHTML(tx) + '</div>' +
      '</div>';
    }
  }

  return wrapCardPage(strategy.title, html);
}

const KRAKEN_ICON = { bg: "#5741d9", letter: "K" };

function extractContractSymbol(contract?: string): string | null {
  if (!contract) return null;
  return contract.replace(/^pf_/, "").replace(/usd$/, "").toUpperCase();
}

function formatAmountWithCurrency(value: number, currency: string): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(value);
  if (abs < 0.01) return abs.toFixed(4).replace(".", ",") + " " + sym;
  return abs.toFixed(2).replace(".", ",") + " " + sym;
}

const futuresStrategy: TransactionViewStrategy<FuturesTransaction> = {
  title: "Transactions History",
  walletName: "Kraken Futures",
  dateField: "date",

  getLabel(tx) {
    return { text: tx.type, colorClass: "" };
  },

  getMiddleIcons(tx) {
    const currIcon = iconFor(tx.currency);
    const contractSym = extractContractSymbol(tx.contract);

    if (tx.type === "Deposit") return arrowFlowHTML(currIcon, KRAKEN_ICON);
    if (tx.type === "Withdrawal") return arrowFlowHTML(KRAKEN_ICON, currIcon);
    if (contractSym) return arrowFlowHTML(iconFor(contractSym), currIcon);
    return "";
  },

  getAmountHTML(tx) {
    const sign = tx.amount >= 0 ? "+" : "-";
    const signClass = tx.amount >= 0 ? "positive" : "negative";
    const eurValue = convertToEur(Math.abs(tx.amount), tx.currency);
    const eurFormatted = formatEurAmount(eurValue);

    let html = '<span class="wallet-label">Kraken Futures</span>' +
      '<div class="amount-line"><span class="sign ' + signClass + '">' + sign + '</span>' +
      '<span class="amount-value ' + signClass + '">' + formatAmountWithCurrency(tx.amount, tx.currency) + '</span></div>';

    if (eurFormatted && tx.currency !== "EUR") html += '<span class="eur-equiv">\u2248 ' + eurFormatted + '</span>';

    if (tx.type === "Realized P&L" && tx.realizedPnL && tx.realizedPnL !== 0) {
      const pnlEur = formatEurAmount(convertToEur(Math.abs(tx.realizedPnL), tx.currency));
      if (pnlEur) html += ' <span class="pnl-dot">\u2022</span> <span class="eur-equiv">' + pnlEur + '</span>';
    }
    return html;
  },

  getTagHTML(tx) {
    return tx.tag ? '<span class="tag-badge">\uD83D\uDCC8 ' + tx.tag + '</span>' : "";
  },

  isTallRow(tx) {
    const isTransfer = tx.type === "Deposit" || tx.type === "Withdrawal";
    return (isTransfer && tx.currency === "USD") || tx.type === "Realized P&L" || tx.type === "Funding fee";
  },
};

const INFLOW_TYPES = new Set(["buy", "fiat_deposit", "crypto_deposit"]);
const OUTFLOW_TYPES = new Set(["sell", "fiat_withdrawal", "crypto_withdrawal"]);
const TYPE_LABELS: Record<string, string> = {
  buy: "Buy", sell: "Sell", fiat_deposit: "Fiat Deposit", fiat_withdrawal: "Fiat Withdrawal",
  crypto_deposit: "Crypto Deposit", crypto_withdrawal: "Crypto Withdrawal",
};

const spotStrategy: TransactionViewStrategy<SpotTransaction> = {
  title: "Spot Transactions History",
  walletName: "Kraken Spot",
  dateField: "date",

  getLabel(tx) {
    const text = TYPE_LABELS[tx.type] || tx.type;
    const colorClass = INFLOW_TYPES.has(tx.type) ? "positive" : OUTFLOW_TYPES.has(tx.type) ? "negative" : "";
    return { text, colorClass };
  },

  getMiddleIcons(tx) {
    const isTrade = tx.type === "buy" || tx.type === "sell";
    const fromCur = tx.from?.currency?.symbol || "";
    const toCur = tx.to?.currency?.symbol || "";

    if (isTrade) return arrowFlowHTML(iconFor(fromCur), iconFor(toCur));
    if (INFLOW_TYPES.has(tx.type)) return arrowFlowHTML(iconFor(toCur), KRAKEN_ICON);
    if (OUTFLOW_TYPES.has(tx.type)) return arrowFlowHTML(KRAKEN_ICON, iconFor(fromCur));
    return "";
  },

  getAmountHTML(tx) {
    const isTrade = tx.type === "buy" || tx.type === "sell";
    const fromCur = tx.from?.currency?.symbol || "";
    const toCur = tx.to?.currency?.symbol || "";

    let html = '<span class="wallet-label">Kraken Spot</span>';

    if (isTrade) {
      html += '<div class="amount-line"><span class="negative">-' + formatAbsoluteAmount(tx.from!.amount) + ' ' + currencySymbol(fromCur) + '</span></div>';
      html += '<div class="amount-line"><span class="positive">+' + formatAbsoluteAmount(tx.to!.amount) + ' ' + currencySymbol(toCur) + '</span></div>';
    } else if (INFLOW_TYPES.has(tx.type)) {
      html += '<div class="amount-line"><span class="positive">+' + formatAbsoluteAmount(tx.to!.amount) + ' ' + currencySymbol(toCur) + '</span></div>';
    } else {
      html += '<div class="amount-line"><span class="negative">-' + formatAbsoluteAmount(tx.from!.amount) + ' ' + currencySymbol(fromCur) + '</span></div>';
    }

    const feeValue = parseFloat(tx.fee_value || "0");
    if (feeValue > 0) {
      const feeCur = tx.fee?.currency?.symbol || "";
      html += '<span class="fee-label">Fee: ' + formatAbsoluteAmount(tx.fee!.amount) + ' ' + currencySymbol(feeCur) + '</span>';
    }
    const gain = parseFloat(tx.gain || "0");
    if (gain !== 0) {
      const cls = gain >= 0 ? "positive" : "negative";
      html += '<span class="gain-label ' + cls + '">P&L: ' + (gain >= 0 ? "+" : "") + gain.toFixed(4) + ' \u20AC</span>';
    }
    return html;
  },

  getTagHTML(tx) {
    return tx.label ? '<span class="tag-badge">' + tx.label.replace(/_/g, " ") + '</span>' : "";
  },

  isTallRow(tx) {
    const isTrade = tx.type === "buy" || tx.type === "sell";
    return isTrade || parseFloat(tx.fee_value || "0") > 0 || parseFloat(tx.gain || "0") !== 0;
  },
};

export function buildFuturesTransactionsHTML(transactions: FuturesTransaction[]): string {
  return buildCardHTML(transactions, futuresStrategy);
}

export function buildSpotTransactionsHTML(transactions: SpotTransaction[]): string {
  return buildCardHTML(transactions, spotStrategy);
}
