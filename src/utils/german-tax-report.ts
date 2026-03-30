import type {
  SpotTransaction,
  NormalizedPosition,
  FuturesTransaction,
} from "../types/common.ts";

// --- Types ---

interface TaxReportInput {
  year: number;
  eurUsdRate: number;
  spotTransactions: SpotTransaction[];
  spotPositions: NormalizedPosition[];
  futuresTransactions: FuturesTransaction[];
}

interface SpotSellRow {
  date: string;
  type: "Spot_Sell" | "Crypto_Swap";
  asset: string;
  amount: string;
  proceedsEur: number;
  costBasisEur: number;
  feeEur: number;
  gainEur: number;
  holdingPeriod: string;
  taxable: string;
  id: string;
}

interface MarginRow {
  date: string;
  type: string;
  asset: string;
  amount: string;
  pnlEur: number;
  id: string;
}

interface LoanFeeRow {
  date: string;
  amountEur: number;
  id: string;
}

interface FuturesRow {
  date: string;
  contract: string;
  type: string;
  amountUsd: number;
  amountEur: number;
  feeEur: number;
}

interface Section23Summary {
  spotSells: SpotSellRow[];
  spotGains: number;
  spotLosses: number;
  spotFees: number;
  taxFreeGains: number;      // gains from positions held >1 year
  marginPositions: MarginRow[];
  marginGains: number;
  marginLosses: number;
  loanFees: LoanFeeRow[];
  loanFeesTotal: number;
  totalGains: number;
  totalLosses: number;
  netResult: number;
  freigrenze: number;
  freigrenzeApplies: boolean;
}

interface Section22Summary {
  stakingRewards: { date: string; asset: string; amount: string; eurValue: number }[];
  totalIncome: number;
  freigrenzeApplies: boolean;
}

interface Section20Summary {
  rows: FuturesRow[];
  totalGains: number;
  totalLosses: number;
  cappedLosses: number;       // losses after €20,000 cap
  excessLossCarryForward: number; // losses exceeding cap → carry forward
  totalFundingFees: number;
  netResult: number;
}

export interface GermanTaxReport {
  year: number;
  eurUsdRate: number;
  section23: Section23Summary;
  section22: Section22Summary;
  section20: Section20Summary;
  csv: string;
}

// --- Helpers ---

function inTaxYear(dateStr: string, year: number): boolean {
  const d = new Date(dateStr);
  return d.getFullYear() === year;
}

function usdToEur(usd: number, rate: number): number {
  return +(usd * rate).toFixed(4);
}

function r(n: number): number {
  return +n.toFixed(4);
}

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function freigrenzeForYear(year: number): number {
  return year >= 2024 ? 1000 : 600;
}

function holdingPeriodLabel(costBasisDate: string | undefined, sellDate: string): string {
  if (!costBasisDate) return "<1 year (unbekannt)";
  const acquiredMs = new Date(costBasisDate).getTime();
  const soldMs = new Date(sellDate).getTime();
  const held = soldMs - acquiredMs;
  if (held >= ONE_YEAR_MS) return ">1 year";
  const days = Math.floor(held / (24 * 60 * 60 * 1000));
  return `${days}d (<1 year)`;
}

// --- Builder ---

export function buildGermanTaxReport(input: TaxReportInput): GermanTaxReport {
  const { year, eurUsdRate, spotTransactions, spotPositions, futuresTransactions } = input;
  const freigrenze = freigrenzeForYear(year);

  // ===== § 23 EStG — Private Veräußerungsgeschäfte =====

  // Filter to tax year
  const txns = spotTransactions.filter((t) => inTaxYear(t.date, year));
  const positions = spotPositions.filter((p) => inTaxYear(p.positionClosed, year));
  const futuresTxns = futuresTransactions.filter((t) => inTaxYear(t.date, year));

  // A1: Spot sells (+ crypto-to-crypto swaps)
  const sells = txns.filter((t) => t.type === "sell" || (t.type === "buy" && t.label === "crypto_swap"));
  const spotSellRows: SpotSellRow[] = [];
  let spotGains = 0,
    spotLosses = 0,
    spotFees = 0;
  let taxFreeGains = 0;

  for (const s of sells) {
    const gain = parseFloat(s.gain);
    const fee = parseFloat(s.fee_value);
    const hp = holdingPeriodLabel(s.from?.cost_basis_date, s.date);
    const isLongTerm = hp.startsWith(">1 year");

    if (isLongTerm) {
      // Held >1 year: tax-free regardless of amount (§ 23 Abs. 1 S. 1 Nr. 2 EStG)
      taxFreeGains += gain;
    } else {
      if (gain >= 0) spotGains += gain;
      else spotLosses += gain;
    }
    spotFees += fee;

    const isSwap = s.label === "crypto_swap";
    spotSellRows.push({
      date: s.date.split("T")[0],
      type: isSwap ? "Crypto_Swap" : "Spot_Sell",
      asset: s.from?.currency?.symbol || "?",
      amount: s.from?.amount || "0",
      proceedsEur: parseFloat(s.to?.amount || s.net_value),
      costBasisEur: parseFloat(s.from?.cost_basis || "0"),
      feeEur: fee,
      gainEur: gain,
      holdingPeriod: hp,
      taxable: isLongTerm ? "Nein (>1 Jahr)" : "pending",
      id: s.id,
    });
  }

  // A2: Margin positions
  const marginRows: MarginRow[] = [];
  let marginGains = 0,
    marginLosses = 0;

  for (const p of positions) {
    // Convert USD positions to EUR
    let pnlEur = p.pnl;
    if (p.currency === "USD") {
      pnlEur = usdToEur(p.pnl, eurUsdRate);
    }

    if (pnlEur >= 0) marginGains += pnlEur;
    else marginLosses += pnlEur;

    marginRows.push({
      date: p.positionClosed.split("T")[0],
      type: `Margin_${p.side}`,
      asset: p.market,
      amount: String(p.quantity),
      pnlEur: r(pnlEur),
      id: p.id,
    });
  }

  // A3: Loan fees (deductible)
  const loanFeeTxns = txns.filter((t) => t.label === "loan_fee");
  const loanFeeRows: LoanFeeRow[] = [];
  let loanFeesTotal = 0;

  for (const l of loanFeeTxns) {
    const val = parseFloat(l.net_value);
    loanFeesTotal += val;
    loanFeeRows.push({
      date: l.date.split("T")[0],
      amountEur: val,
      id: l.id,
    });
  }

  // § 23 totals
  const totalGains = r(spotGains + marginGains);
  const totalLosses = r(spotLosses + marginLosses);
  const netResult23 = r(totalGains + totalLosses - loanFeesTotal);
  const freigrenzeApplies23 = totalGains < freigrenze;

  const taxableLabel = freigrenzeApplies23 ? `Nein (Freigrenze ${freigrenze} EUR)` : "Ja";
  for (const row of spotSellRows) {
    if (row.taxable === "pending") row.taxable = taxableLabel;
  }

  // ===== § 22 Nr. 3 EStG — Staking =====
  const stakingTxns = txns.filter((t) => t.label === "staking");
  const stakingRewards = stakingTxns.map((s) => ({
    date: s.date.split("T")[0],
    asset: s.to?.currency?.symbol || "?",
    amount: s.to?.amount || "0",
    eurValue: parseFloat(s.net_value),
  }));
  const totalStaking = stakingRewards.reduce((sum, r) => sum + r.eurValue, 0);
  const freigrenzeApplies22 = totalStaking < 256;

  // ===== § 20 EStG — Futures =====
  const futuresPnL = futuresTxns.filter((t) => t.type === "Realized P&L");
  const futuresFunding = futuresTxns.filter((t) => t.type === "Funding fee");

  const futuresRows: FuturesRow[] = [];
  let futuresGains = 0,
    futuresLosses = 0,
    fundingFeesTotal = 0;

  for (const t of futuresPnL) {
    const amountEur = usdToEur(t.amount, eurUsdRate);
    const feeEur = usdToEur(t.fee || 0, eurUsdRate);
    const pnlEur = usdToEur(t.realizedPnL || 0, eurUsdRate);
    if (pnlEur >= 0) futuresGains += pnlEur;
    else futuresLosses += pnlEur;
    futuresRows.push({
      date: t.date.split("T")[0],
      contract: t.contract || "",
      type: "Realized P&L",
      amountUsd: t.amount,
      amountEur,
      feeEur,
    });
  }

  for (const t of futuresFunding) {
    const amountEur = usdToEur(t.amount, eurUsdRate);
    fundingFeesTotal += amountEur;
    futuresRows.push({
      date: t.date.split("T")[0],
      contract: t.contract || "",
      type: "Funding fee",
      amountUsd: t.amount,
      amountEur,
      feeEur: 0,
    });
  }

  // § 20 Abs. 6 S. 5 EStG: derivative losses capped at €20,000/year
  const DERIVATIVE_LOSS_CAP = -20000;
  const cappedFuturesLosses = Math.max(futuresLosses, DERIVATIVE_LOSS_CAP);
  const excessFuturesLoss = r(futuresLosses - cappedFuturesLosses); // negative = carry-forward
  const netResult20 = r(futuresGains + cappedFuturesLosses + fundingFeesTotal);

  // ===== CSV =====
  const csvLines: string[] = [];
  csvLines.push(
    "Category,Date,Type,Asset,Amount,Proceeds_EUR,Cost_Basis_EUR,Fee_EUR,Gain_Loss_EUR,Holding_Period,Taxable,ID",
  );

  for (const row of spotSellRows) {
    csvLines.push(
      `Anlage_SO_s23,${row.date},${row.type},${row.asset},${row.amount},${row.proceedsEur},${row.costBasisEur},${row.feeEur},${row.gainEur},${row.holdingPeriod},${row.taxable},${row.id}`,
    );
  }
  for (const row of marginRows) {
    csvLines.push(
      `Anlage_SO_s23,${row.date},${row.type},${row.asset},${row.amount},,,,${row.pnlEur},<1 year,${taxableLabel},${row.id}`,
    );
  }
  for (const row of loanFeeRows) {
    csvLines.push(
      `Anlage_SO_s23_LoanFee,${row.date},Loan_Fee,EUR,${row.amountEur},,,,${(-row.amountEur).toFixed(4)},,Deductible,${row.id}`,
    );
  }
  for (const row of stakingRewards) {
    csvLines.push(
      `Anlage_SO_s22,${row.date},Staking,${row.asset},${row.amount},,,,${row.eurValue},,,`,
    );
  }
  for (const row of futuresRows) {
    csvLines.push(
      `Anlage_KAP_s20,${row.date},${row.type},${row.contract},${row.amountUsd},${row.amountEur},,${row.feeEur},${row.amountEur},,,,`,
    );
  }

  return {
    year,
    eurUsdRate,
    section23: {
      spotSells: spotSellRows,
      spotGains: r(spotGains),
      spotLosses: r(spotLosses),
      spotFees: r(spotFees),
      taxFreeGains: r(taxFreeGains),
      marginPositions: marginRows,
      marginGains: r(marginGains),
      marginLosses: r(marginLosses),
      loanFees: loanFeeRows,
      loanFeesTotal: r(loanFeesTotal),
      totalGains,
      totalLosses,
      netResult: netResult23,
      freigrenze,
      freigrenzeApplies: freigrenzeApplies23,
    },
    section22: {
      stakingRewards,
      totalIncome: r(totalStaking),
      freigrenzeApplies: freigrenzeApplies22,
    },
    section20: {
      rows: futuresRows,
      totalGains: r(futuresGains),
      totalLosses: r(futuresLosses),
      cappedLosses: r(cappedFuturesLosses),
      excessLossCarryForward: r(excessFuturesLoss),
      totalFundingFees: r(fundingFeesTotal),
      netResult: netResult20,
    },
    csv: csvLines.join("\n"),
  };
}

// --- Compact text summary for MCP output ---

export function formatTaxReportSummary(report: GermanTaxReport): string {
  const { year, eurUsdRate, section23: s23, section22: s22, section20: s20 } = report;
  const f = (n: number) => n.toFixed(2);

  let out = `# Krypto-Steuerbericht ${year}\n`;
  out += `EUR/USD-Kurs: ${eurUsdRate.toFixed(4)}\n\n`;

  // § 23
  out += `## A. Anlage SO — Private Veräußerungsgeschäfte (§ 23 EStG)\n\n`;
  out += `Spot-Verkäufe/Swaps: ${s23.spotSells.length} | Gewinne: +${f(s23.spotGains)} EUR | Verluste: ${f(s23.spotLosses)} EUR | Gebühren: ${f(s23.spotFees)} EUR\n`;
  if (s23.taxFreeGains !== 0) {
    out += `Steuerfrei (Haltefrist >1 Jahr): ${f(s23.taxFreeGains)} EUR\n`;
  }
  out += `Margin-Positionen: ${s23.marginPositions.length} | Gewinne: +${f(s23.marginGains)} EUR | Verluste: ${f(s23.marginLosses)} EUR\n`;
  out += `Rollover-Gebühren: ${s23.loanFees.length} Buchungen | Gesamt: -${f(s23.loanFeesTotal)} EUR (abzugsfähig)\n\n`;
  out += `**Gesamt § 23:**\n`;
  out += `  Steuerpflichtige Gewinne: +${f(s23.totalGains)} EUR\n`;
  out += `  Verluste: ${f(s23.totalLosses)} EUR\n`;
  out += `  Netto: ${f(s23.netResult)} EUR\n`;
  out += `  Freigrenze (${s23.freigrenze} EUR): ${s23.freigrenzeApplies ? "GREIFT — alle Gewinne steuerfrei" : "ÜBERSCHRITTEN — voll steuerpflichtig"}\n\n`;

  // § 22
  out += `## B. Anlage SO — Sonstige Einkünfte (§ 22 Nr. 3 EStG)\n\n`;
  if (s22.stakingRewards.length === 0) {
    out += `Keine Staking-Erträge im Jahr ${year}.\n\n`;
  } else {
    out += `Staking-Erträge: ${s22.stakingRewards.length} | Gesamt: ${f(s22.totalIncome)} EUR\n`;
    out += `Freigrenze (256 EUR): ${s22.freigrenzeApplies ? "GREIFT" : "ÜBERSCHRITTEN"}\n\n`;
  }

  // § 20
  out += `## C. Anlage KAP — Kapitalerträge (§ 20 EStG)\n\n`;
  if (s20.rows.length === 0) {
    out += `Keine Futures-Transaktionen im Jahr ${year}.\n\n`;
  } else {
    out += `Futures P&L: ${s20.rows.filter((r) => r.type === "Realized P&L").length} Trades\n`;
    out += `  Gewinne: +${f(s20.totalGains)} EUR\n`;
    out += `  Verluste: ${f(s20.totalLosses)} EUR\n`;
    if (s20.excessLossCarryForward !== 0) {
      out += `  Davon verrechenbar (§ 20 Abs. 6 S. 5, max 20.000 EUR): ${f(s20.cappedLosses)} EUR\n`;
      out += `  Verlustvortrag: ${f(s20.excessLossCarryForward)} EUR\n`;
    }
    out += `Funding Fees: ${f(s20.totalFundingFees)} EUR\n`;
    out += `Netto: ${f(s20.netResult)} EUR\n\n`;
  }

  // Summary
  out += `## D. Zusammenfassung\n\n`;
  out += `| Kategorie | Ergebnis | Steuerpflicht |\n`;
  out += `|---|---|---|\n`;
  out += `| § 23 Private Veräußerungsgeschäfte | ${f(s23.netResult)} EUR | ${s23.freigrenzeApplies ? "Keine (Freigrenze)" : "Steuerpflichtig"} |\n`;
  out += `| § 22 Nr. 3 Staking | ${f(s22.totalIncome)} EUR | ${s22.stakingRewards.length === 0 ? "Keine" : s22.freigrenzeApplies ? "Keine (Freigrenze)" : "Steuerpflichtig"} |\n`;
  out += `| § 20 Futures | ${f(s20.netResult)} EUR | ${s20.rows.length === 0 ? "Keine" : "Abgeltungsteuer"} |\n\n`;

  // Elster
  out += `### Elster-Eintragungen\n\n`;
  if (s23.freigrenzeApplies && s23.netResult < 0) {
    out += `Anlage SO Zeile 42: ${f(Math.abs(s23.netResult))} EUR Verlust (Verlustvortrag beantragen)\n`;
  } else if (!s23.freigrenzeApplies) {
    out += `Anlage SO Zeile 41: ${f(s23.totalGains)} EUR Gewinne\n`;
    out += `Anlage SO Zeile 42: ${f(Math.abs(s23.totalLosses))} EUR Verluste\n`;
  }
  if (s22.totalIncome > 0 && !s22.freigrenzeApplies) {
    out += `Anlage SO Zeile 46: ${f(s22.totalIncome)} EUR Staking\n`;
  }
  if (s20.rows.length > 0) {
    out += `Anlage KAP Zeile 7: ${f(s20.totalGains)} EUR Kapitalerträge\n`;
    out += `Anlage KAP Zeile 8: ${f(Math.abs(s20.totalLosses))} EUR Verluste\n`;
  }

  out += `\nCSV mit ${report.csv.split("\n").length - 1} Einzeltransaktionen ist im Feld "csv" enthalten.`;
  return out;
}
