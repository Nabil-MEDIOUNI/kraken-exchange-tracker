import type { AccountLog } from "../types/kraken.ts";
import type { FuturesTransaction } from "../types/common.ts";

export function buildFuturesTransactions(logs: AccountLog[]): FuturesTransaction[] {
  const transactions: FuturesTransaction[] = [];

  const tradeGroups: Record<string, AccountLog[]> = {};
  for (const log of logs) {
    if (log.info?.toLowerCase() === "futures trade") {
      const key = log.date + "|" + log.contract;
      if (!tradeGroups[key]) tradeGroups[key] = [];
      tradeGroups[key].push(log);
    }
  }
  for (const entries of Object.values(tradeGroups)) {
    let totalFee = 0, totalPnL = 0;
    const { date, contract, asset } = entries[0];
    for (const entry of entries) { totalFee += entry.fee || 0; totalPnL += entry.realized_pnl || 0; }
    transactions.push({
      type: "Realized P&L", date, contract,
      currency: asset?.toUpperCase() || "USD",
      amount: +(totalPnL - totalFee).toFixed(4),
      fee: +totalFee.toFixed(6),
      realizedPnL: +totalPnL.toFixed(6),
      tag: "futures trade",
    });
  }

  const fundingLogs = logs.filter((l) => l.info?.toLowerCase() === "funding rate change").sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const tradeTimesByContract: Record<string, number[]> = {};
  for (const log of logs) {
    if (log.info?.toLowerCase() === "futures trade" && log.contract) {
      if (!tradeTimesByContract[log.contract]) tradeTimesByContract[log.contract] = [];
      tradeTimesByContract[log.contract].push(new Date(log.date).getTime());
    }
  }
  for (const times of Object.values(tradeTimesByContract)) times.sort((a, b) => a - b);

  const fundingGroups: Record<string, AccountLog[]> = {};
  for (const log of fundingLogs) {
    const timestamp = new Date(log.date).getTime();
    const contractTimes = tradeTimesByContract[log.contract] || [];
    const nextTradeTime = contractTimes.find((t) => t > timestamp) || "end";
    const key = log.contract + "|" + nextTradeTime;
    if (!fundingGroups[key]) fundingGroups[key] = [];
    fundingGroups[key].push(log);
  }
  for (const entries of Object.values(fundingGroups)) {
    let total = 0;
    for (const entry of entries) total += entry.realized_funding ?? (entry.new_balance - entry.old_balance);
    const latest = entries[entries.length - 1];
    transactions.push({
      type: "Funding fee", date: latest.date, contract: latest.contract,
      currency: latest.asset?.toUpperCase() || "USD",
      amount: +total.toFixed(6),
    });
  }

  for (const log of logs) {
    if (log.info === "cross-exchange transfer") {
      const amount = log.new_balance - log.old_balance;
      transactions.push({
        type: amount > 0 ? "Deposit" : "Withdrawal",
        date: log.date,
        currency: log.asset?.toUpperCase() || "USD",
        amount: +Math.abs(amount).toFixed(4),
      });
    }
  }

  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return transactions;
}
