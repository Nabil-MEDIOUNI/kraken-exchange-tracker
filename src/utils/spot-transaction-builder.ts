import type { SpotLedgerEntry, SpotTrade } from "../types/kraken.ts";
import type { SpotTransaction, CurrencyAmount } from "../types/common.ts";

const FIAT = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD"];
const SPOT_BASE_URL = "https://api.kraken.com";

function truncDate(ts: number): string {
  const d = new Date(ts * 1000);
  d.setMilliseconds(0);
  return d.toISOString();
}

function fmtVal(n: number): string {
  if (Math.abs(n) < 1e-12) return "0.0";
  const s = parseFloat(n.toFixed(10)).toString();
  return s.includes(".") ? s : s + ".0";
}

function fmtAmt(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  const s = parseFloat(n.toFixed(10)).toString();
  return s.includes(".") ? s : s + ".0";
}

interface Lot {
  qty: number;
  cpu: number;
}

function createLotTracker() {
  const lots: Record<string, Lot[]> = {};

  function addLot(asset: string, qty: number, totalCost: number): void {
    if (qty <= 0) return;
    if (!lots[asset]) lots[asset] = [];
    lots[asset].push({ qty, cpu: totalCost / qty });
  }

  function consumeLots(asset: string, qty: number): number {
    if (!lots[asset] || qty <= 0) return 0;
    let rem = qty;
    let cost = 0;
    while (rem > 1e-12 && lots[asset].length > 0) {
      const lot = lots[asset][0];
      const take = Math.min(rem, lot.qty);
      cost += take * lot.cpu;
      lot.qty -= take;
      rem -= take;
      if (lot.qty < 1e-12) lots[asset].shift();
    }
    return parseFloat(cost.toFixed(10));
  }

  return { addLot, consumeLots };
}

function createPriceCache() {
  const cache: Record<string, number> = {};

  async function getEurPrice(asset: string, timestamp: number): Promise<number> {
    const minute = Math.floor(timestamp / 60) * 60;
    const key = `${asset}_${minute}`;
    if (cache[key] !== undefined) return cache[key];

    const pairs: Record<string, string> = {
      BTC: "XXBTZEUR", ETH: "XETHZEUR", SOL: "SOLEUR", XRP: "XXRPZEUR",
      ADA: "ADAEUR", DOT: "DOTEUR", PEPE: "PEPEEUR", ALGO: "ALGOEUR",
      DOGE: "XDGEUR", XDG: "XDGEUR", LTC: "XLTCZEUR",
    };
    const pair = pairs[asset];
    if (!pair) { cache[key] = 0; return 0; }

    try {
      const res = await fetch(`${SPOT_BASE_URL}/0/public/OHLC?pair=${pair}&since=${minute - 120}&interval=1`);
      const data = await res.json();
      if (data.error?.length) { cache[key] = 0; return 0; }
      const candles = Object.values(data.result).find(Array.isArray) as number[][] | undefined;
      if (candles?.length) {
        const price = parseFloat(String(candles[candles.length - 1][4]));
        cache[key] = price;
        return price;
      }
    } catch { /* ignore */ }
    cache[key] = 0;
    return 0;
  }

  async function getUsdEurRate(timestamp: number): Promise<number> {
    const minute = Math.floor(timestamp / 60) * 60;
    const key = `USDEUR_${minute}`;
    if (cache[key] !== undefined) return cache[key];

    try {
      const [eurRes, usdRes] = await Promise.all([
        fetch(`${SPOT_BASE_URL}/0/public/OHLC?pair=XXBTZEUR&since=${minute - 120}&interval=1`),
        fetch(`${SPOT_BASE_URL}/0/public/OHLC?pair=XXBTZUSD&since=${minute - 120}&interval=1`),
      ]);
      const eurData = await eurRes.json();
      const usdData = await usdRes.json();
      const eurCandles = Object.values(eurData.result).find(Array.isArray) as number[][] | undefined;
      const usdCandles = Object.values(usdData.result).find(Array.isArray) as number[][] | undefined;
      if (eurCandles?.length && usdCandles?.length) {
        const btcEur = parseFloat(String(eurCandles[eurCandles.length - 1][4]));
        const btcUsd = parseFloat(String(usdCandles[usdCandles.length - 1][4]));
        const rate = btcEur / btcUsd;
        cache[key] = rate;
        return rate;
      }
    } catch { /* ignore */ }
    cache[key] = 0.866;
    return 0.866;
  }

  return { getEurPrice, getUsdEurRate };
}

interface NormalizerFns {
  normalizeAsset: (asset: string) => string;
  parsePair: (pair: string) => { base: string; quote: string };
}

interface DailyMarginData {
  gains: number;
  losses: number;
  currency: string;
  gainDate: string;
  lossDate: string;
}

interface DailyRolloverData {
  total: number;
  currency: string;
  latestDate: string;
}

function makeTx(fields: Partial<SpotTransaction> & { id: string; type: string; date: string }): SpotTransaction {
  return {
    description: null, label: null, txhash: null,
    net_value: "0.0", fee_value: "0.0", gain: "0.0",
    ...fields,
  } as SpotTransaction;
}

export async function buildSpotTransactions(
  ledgers: Record<string, SpotLedgerEntry>,
  trades: Record<string, SpotTrade>,
  { normalizeAsset, parsePair }: NormalizerFns,
): Promise<SpotTransaction[]> {
  const { addLot, consumeLots } = createLotTracker();
  const { getEurPrice, getUsdEurRate } = createPriceCache();

  const ledgersByRefid: Record<string, (SpotLedgerEntry & { ledger_id: string })[]> = {};
  for (const [id, entry] of Object.entries(ledgers)) {
    if (!ledgersByRefid[entry.refid]) ledgersByRefid[entry.refid] = [];
    ledgersByRefid[entry.refid].push({ ...entry, ledger_id: id });
  }

  type Event =
    | { kind: "trade"; time: number; txid: string; data: SpotTrade }
    | { kind: "margin_trade"; time: number; txid: string; data: SpotTrade }
    | { kind: "ledger"; time: number; id: string; data: SpotLedgerEntry };

  const events: Event[] = [];
  for (const [txid, trade] of Object.entries(trades)) {
    const isMargin = parseFloat(trade.margin || "0") > 0;
    events.push({ kind: isMargin ? "margin_trade" : "trade", time: trade.time, txid, data: trade });
  }

  const tradeLedgerIds = new Set<string>();
  for (const [id, entry] of Object.entries(ledgers)) {
    if (entry.type === "trade") tradeLedgerIds.add(id);
  }
  for (const [id, entry] of Object.entries(ledgers)) {
    if (!tradeLedgerIds.has(id)) {
      events.push({ kind: "ledger", time: entry.time, id, data: entry });
    }
  }

  events.sort((a, b) => a.time - b.time);

  const transactions: SpotTransaction[] = [];
  const marginByDay: Record<string, DailyMarginData> = {};
  const rolloverByDay: Record<string, DailyRolloverData> = {};

  for (const event of events) {
    if (event.kind === "trade") {
      const trade = event.data;
      const txid = event.txid;
      const { base, quote } = parsePair(trade.pair);
      const isBuy = trade.type === "buy";
      const vol = parseFloat(trade.vol);
      const cost = parseFloat(trade.cost);
      const fee = parseFloat(trade.fee);
      const price = vol > 0 ? cost / vol : 0;

      let feeCurrency = quote;
      let feeAmount = fee;
      const tradeLedgers = ledgersByRefid[txid] || [];
      for (const le of tradeLedgers) {
        if (le.type === "trade" && parseFloat(le.fee) > 0) {
          feeCurrency = normalizeAsset(le.asset);
          feeAmount = Math.abs(parseFloat(le.fee));
          break;
        }
      }

      const feeInCrypto = !FIAT.includes(feeCurrency);
      const feeValueEur = feeInCrypto ? feeAmount * price : feeAmount;

      let fromCB: number, toCB: number, gain: number;
      if (isBuy) {
        const totalCost = cost + feeValueEur;
        addLot(base, vol, totalCost);
        if (feeInCrypto) { const feeCB = consumeLots(base, feeAmount); fromCB = feeCB; gain = -(feeCB - feeValueEur); }
        else { fromCB = 0; gain = 0; }
        toCB = totalCost;
      } else {
        const soldCB = consumeLots(base, vol);
        fromCB = soldCB; toCB = 0; gain = cost - soldCB - feeValueEur;
      }

      transactions.push({
        id: txid, type: isBuy ? "buy" : "sell", date: truncDate(trade.time),
        description: null, label: null, txhash: txid,
        from: { amount: fmtAmt(isBuy ? trade.cost : trade.vol), currency: { symbol: isBuy ? quote : base }, cost_basis: fmtVal(fromCB) },
        to: { amount: fmtAmt(isBuy ? trade.vol : trade.cost), currency: { symbol: isBuy ? base : quote }, cost_basis: fmtVal(toCB) },
        fee: { amount: fmtAmt(feeAmount), currency: { symbol: feeCurrency } },
        net_value: fmtVal(cost), fee_value: fmtVal(feeValueEur), gain: fmtVal(gain),
      });
    } else if (event.kind === "margin_trade") {
    } else {
      const entry = event.data;
      const id = event.id;
      const amount = parseFloat(entry.amount);
      const fee = parseFloat(entry.fee);
      const symbol = normalizeAsset(entry.asset);
      const isFiat = FIAT.includes(symbol);
      const date = truncDate(entry.time);
      const abs = Math.abs(amount);

      let tx: SpotTransaction | null = null;

      if (entry.type === "deposit") {
        const totalAmt = abs + fee;
        if (isFiat) {
          let netVal = totalAmt;
          if (symbol !== "EUR") netVal = totalAmt * await getUsdEurRate(entry.time);
          tx = makeTx({ id, type: "fiat_deposit", date,
            to: { amount: fmtAmt(totalAmt), currency: { symbol }, cost_basis: "0.0" },
            net_value: fmtVal(netVal) });
        } else {
          const eurPrice = await getEurPrice(symbol, entry.time);
          const eurValue = totalAmt * eurPrice;
          addLot(symbol, totalAmt, eurValue);
          tx = makeTx({ id, type: "crypto_deposit", date,
            to: { amount: fmtAmt(totalAmt), currency: { symbol }, cost_basis: fmtVal(eurValue) },
            net_value: fmtVal(eurValue) });
        }
      } else if (entry.type === "withdrawal") {
        const totalAmt = abs + fee;
        if (isFiat) {
          let netVal = totalAmt;
          if (symbol !== "EUR") netVal = totalAmt * await getUsdEurRate(entry.time);
          tx = makeTx({ id, type: "fiat_withdrawal", date,
            from: { amount: fmtAmt(totalAmt), currency: { symbol }, cost_basis: "0.0" },
            net_value: fmtVal(netVal) });
        } else {
          const costBasis = consumeLots(symbol, totalAmt);
          const eurPrice = await getEurPrice(symbol, entry.time);
          const eurValue = totalAmt * eurPrice;
          tx = makeTx({ id, type: "crypto_withdrawal", date,
            from: { amount: fmtAmt(totalAmt), currency: { symbol }, cost_basis: fmtVal(costBasis) },
            net_value: fmtVal(eurValue), gain: fmtVal(eurValue - costBasis) });
        }
      } else if (entry.type === "margin") {
        const netPnl = amount - fee;
        if (Math.abs(netPnl) > 1e-10) {
          const dayKey = date.substring(0, 10);
          if (!marginByDay[dayKey]) marginByDay[dayKey] = { gains: 0, losses: 0, currency: symbol, gainDate: date, lossDate: date };
          if (netPnl > 0) { marginByDay[dayKey].gains += netPnl; if (date > marginByDay[dayKey].gainDate) marginByDay[dayKey].gainDate = date; }
          else { marginByDay[dayKey].losses += Math.abs(netPnl); if (date > marginByDay[dayKey].lossDate) marginByDay[dayKey].lossDate = date; }
        }
      } else if (entry.type === "rollover") {
        const loanFee = fee > 0 ? fee : abs;
        if (loanFee > 1e-10) {
          const dayKey = date.substring(0, 10);
          if (!rolloverByDay[dayKey]) rolloverByDay[dayKey] = { total: 0, currency: symbol, latestDate: date };
          rolloverByDay[dayKey].total += loanFee;
          if (date > rolloverByDay[dayKey].latestDate) rolloverByDay[dayKey].latestDate = date;
        }
      } else if (entry.type === "adjustment") {
        const adjAmt = Math.abs(fee) > 0 ? Math.abs(fee) : abs;
        if (adjAmt >= 1e-10) {
          tx = makeTx({ id, type: isFiat ? "fiat_withdrawal" : "crypto_withdrawal", date,
            from: { amount: fmtAmt(adjAmt), currency: { symbol }, cost_basis: "0.0" },
            net_value: fmtVal(adjAmt) });
        }
      } else if (entry.type === "receive") {
        const spendEntries = (ledgersByRefid[entry.refid] || []).filter((e) => e.type === "spend");
        if (spendEntries.length > 0) {
          const spend = spendEntries[0];
          const spentAmt = Math.abs(parseFloat(spend.amount));
          const spentFee = parseFloat(spend.fee);
          const spentSymbol = normalizeAsset(spend.asset);
          const totalSpent = spentAmt + spentFee;
          addLot(symbol, abs, totalSpent);
          tx = {
            id, type: "buy", date, description: null, label: null, txhash: entry.refid,
            from: { amount: fmtAmt(spentAmt), currency: { symbol: spentSymbol }, cost_basis: fmtVal(spentFee) },
            to: { amount: fmtAmt(abs), currency: { symbol }, cost_basis: fmtVal(totalSpent) },
            fee: { amount: fmtAmt(spentFee), currency: { symbol: spentSymbol } },
            net_value: fmtVal(spentAmt), fee_value: fmtVal(spentFee), gain: "0.0",
          };
        }
      } else if (entry.type === "spend") {
      } else if (entry.type === "staking") {
        const isIncoming = amount >= 0;
        const side = isIncoming
          ? { to: { amount: fmtAmt(abs), currency: { symbol }, cost_basis: "0.0" } as CurrencyAmount }
          : { from: { amount: fmtAmt(abs), currency: { symbol }, cost_basis: "0.0" } as CurrencyAmount };
        tx = makeTx({ id, type: isIncoming ? "crypto_deposit" : "crypto_withdrawal", date, label: "staking", ...side, net_value: fmtVal(abs) });
      } else if (entry.type === "transfer") {
        const isIncoming = amount > 0;
        let netVal = abs;
        if (isFiat && symbol !== "EUR") netVal = abs * await getUsdEurRate(entry.time);
        const side = isIncoming
          ? { to: { amount: fmtAmt(abs), currency: { symbol }, cost_basis: "0.0" } as CurrencyAmount }
          : { from: { amount: fmtAmt(abs), currency: { symbol }, cost_basis: "0.0" } as CurrencyAmount };
        tx = makeTx({
          id, type: isIncoming ? (isFiat ? "fiat_deposit" : "crypto_deposit") : (isFiat ? "fiat_withdrawal" : "crypto_withdrawal"),
          date, ...side, net_value: fmtVal(netVal),
        });
      }

      if (tx) transactions.push(tx);
    }
  }

  for (const data of Object.values(marginByDay)) {
    const sym = data.currency;
    const isFiat = FIAT.includes(sym);
    if (data.gains > 1e-10) {
      const amt = parseFloat(data.gains.toFixed(4));
      transactions.push(makeTx({
        id: "margin_gain", type: isFiat ? "fiat_deposit" : "crypto_deposit", date: data.gainDate, label: "realized_gain",
        to: { amount: fmtAmt(amt), currency: { symbol: sym }, cost_basis: "0.0" }, net_value: fmtVal(amt),
      }));
    }
    if (data.losses > 1e-10) {
      const amt = parseFloat(data.losses.toFixed(4));
      transactions.push(makeTx({
        id: "margin_loss", type: isFiat ? "fiat_withdrawal" : "crypto_withdrawal", date: data.lossDate, label: "realized_gain",
        from: { amount: fmtAmt(amt), currency: { symbol: sym }, cost_basis: "0.0" }, net_value: fmtVal(amt),
      }));
    }
  }

  for (const data of Object.values(rolloverByDay)) {
    const sym = data.currency;
    const isFiat = FIAT.includes(sym);
    const amt = parseFloat(data.total.toFixed(4));
    transactions.push(makeTx({
      id: "rollover", type: isFiat ? "fiat_withdrawal" : "crypto_withdrawal", date: data.latestDate, label: "loan_fee",
      from: { amount: fmtAmt(amt), currency: { symbol: sym }, cost_basis: "0.0" }, net_value: fmtVal(amt),
    }));
  }

  transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return transactions;
}
