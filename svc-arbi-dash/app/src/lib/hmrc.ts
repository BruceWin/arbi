import { DateTime } from 'luxon';
import { AssetSymbol, DisposalReport, FlatMatchLine, MatchLine, MatchRule, Trade } from './types';
import { LONDON_TZ, ukDayKey } from './time';

const DAY_DIFF_LIMIT = 30;

type PoolState = {
  totalQty: number;
  totalCostGBP: number;
};

type EnrichedTrade = Trade & {
  remainingQty: number;
  perUnitGBP: number;
  netProceedsPerUnit?: number;
  grossProceedsGBP?: number;
  netProceedsGBP?: number;
  disposalFeesGBP?: number;
  totalCostPerUnit?: number;
  acquisitionCostGBP?: number;
  matches: MatchLine[];
  issues: string[];
};

export type HmrcComputation = {
  disposals: DisposalReport[];
  matchLines: FlatMatchLine[];
  pools: Record<AssetSymbol, { totalQty: number; totalCostGBP: number; avgCostGBP: number }>;
  totals: { overallGainGBP: number; byAsset: Record<AssetSymbol, number> };
  issues: string[];
};

export type HmrcComputationOptions = {
  windowStart?: number;
  windowEnd?: number;
  poolSnapshotAt?: number;
};

function clonePoolState(map: Map<AssetSymbol, PoolState>): Record<AssetSymbol, PoolState & { avgCostGBP: number }> {
  const result: Record<AssetSymbol, PoolState & { avgCostGBP: number }> = {
    BTC: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 },
    ETH: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 },
    USDT: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 }
  };
  for (const [asset, state] of map) {
    const avgCost = state.totalQty > 0 ? state.totalCostGBP / state.totalQty : 0;
    result[asset] = {
      totalQty: state.totalQty,
      totalCostGBP: state.totalCostGBP,
      avgCostGBP: avgCost
    };
  }
  return result;
}

function ensureEnriched(trade: Trade): EnrichedTrade {
  if (!trade.derived) {
    throw new Error(`Trade ${trade.id} missing derived values`);
  }
  const perUnit = trade.derived.perUnitGBP;
  if (!Number.isFinite(perUnit)) {
    throw new Error(`Trade ${trade.id} missing per-unit GBP`);
  }
  const base: EnrichedTrade = {
    ...trade,
    remainingQty: trade.quantity,
    perUnitGBP: perUnit,
    matches: [],
    issues: []
  };
  if (trade.side === 'BUY') {
    const fee = trade.derived.feeGBP ?? 0;
    const acquisitionCost = trade.derived.gbpProceedsOrCost + fee;
    const perUnitCost = acquisitionCost / trade.quantity;
    base.acquisitionCostGBP = acquisitionCost;
    base.totalCostPerUnit = perUnitCost;
  } else {
    const fee = trade.derived.feeGBP ?? 0;
    const gross = trade.derived.gbpProceedsOrCost;
    const net = gross - fee;
    base.disposalFeesGBP = fee;
    base.grossProceedsGBP = gross;
    base.netProceedsGBP = net;
    base.netProceedsPerUnit = net / trade.quantity;
  }
  return base;
}

function applyMatch(
  sell: EnrichedTrade,
  qty: number,
  rule: MatchRule,
  allowableCostGBP: number,
  buy?: EnrichedTrade
): void {
  if (qty <= 0) {
    return;
  }
  if (!sell.netProceedsPerUnit) {
    throw new Error(`Sell trade ${sell.id} missing net proceeds`);
  }
  const proceeds = sell.netProceedsPerUnit * qty;
  const gain = proceeds - allowableCostGBP;
  const match: MatchLine = {
    rule,
    buyRef: buy?.id,
    matchedQty: qty,
    proceedsGBP: proceeds,
    allowableCostGBP,
    gainGBP: gain
  };
  sell.matches.push(match);
  sell.remainingQty = Math.max(0, sell.remainingQty - qty);
  if (buy) {
    buy.remainingQty = Math.max(0, buy.remainingQty - qty);
  }
}

function matchSameDay(byAsset: Map<AssetSymbol, EnrichedTrade[]>): void {
  for (const [asset, trades] of byAsset) {
    const buysByDay = new Map<string, EnrichedTrade[]>();
    const sellsByDay = new Map<string, EnrichedTrade[]>();
    trades
      .filter((t) => t.side === 'BUY')
      .forEach((buy) => {
        const day = ukDayKey(buy.ts);
        const arr = buysByDay.get(day) ?? [];
        arr.push(buy);
        buysByDay.set(day, arr);
      });
    trades
      .filter((t) => t.side === 'SELL')
      .forEach((sell) => {
        const day = ukDayKey(sell.ts);
        const arr = sellsByDay.get(day) ?? [];
        arr.push(sell);
        sellsByDay.set(day, arr);
      });
    for (const [day, sells] of sellsByDay) {
      const buys = (buysByDay.get(day) ?? []).sort((a, b) => a.ts - b.ts);
      sells.sort((a, b) => a.ts - b.ts);
      for (const sell of sells) {
        for (const buy of buys) {
          if (sell.remainingQty <= 0) {
            break;
          }
          if (buy.remainingQty <= 0) {
            continue;
          }
          const qty = Math.min(sell.remainingQty, buy.remainingQty);
          const allowable = qty * (buy.totalCostPerUnit ?? buy.perUnitGBP);
          applyMatch(sell, qty, 'SAME_DAY', allowable, buy);
        }
      }
    }
  }
}

function dayDiff(sell: EnrichedTrade, buy: EnrichedTrade): number {
  const sellDay = DateTime.fromMillis(sell.ts, { zone: LONDON_TZ }).startOf('day');
  const buyDay = DateTime.fromMillis(buy.ts, { zone: LONDON_TZ }).startOf('day');
  return Math.floor(buyDay.diff(sellDay, 'days').days);
}

function matchThirtyDay(byAsset: Map<AssetSymbol, EnrichedTrade[]>): void {
  for (const trades of byAsset.values()) {
    const sells = trades.filter((t) => t.side === 'SELL').sort((a, b) => a.ts - b.ts);
    const buys = trades.filter((t) => t.side === 'BUY').sort((a, b) => a.ts - b.ts);
    for (const sell of sells) {
      if (sell.remainingQty <= 0) {
        continue;
      }
      for (const buy of buys) {
        if (buy.remainingQty <= 0) {
          continue;
        }
        if (buy.ts <= sell.ts) {
          continue;
        }
        const diff = dayDiff(sell, buy);
        if (diff <= 0 || diff > DAY_DIFF_LIMIT) {
          continue;
        }
        const qty = Math.min(sell.remainingQty, buy.remainingQty);
        const allowable = qty * (buy.totalCostPerUnit ?? buy.perUnitGBP);
        applyMatch(sell, qty, 'WITHIN_30_DAYS', allowable, buy);
        if (sell.remainingQty <= 0) {
          break;
        }
      }
    }
  }
}

export function computeHmrc(trades: Trade[], options: HmrcFinalOptions = {}): HmrcComputation {
  const enrichedTrades = trades.map(ensureEnriched);
  const byAsset = new Map<AssetSymbol, EnrichedTrade[]>();
  for (const trade of enrichedTrades) {
    const arr = byAsset.get(trade.asset) ?? [];
    arr.push(trade);
    byAsset.set(trade.asset, arr);
  }
  for (const tradesArr of byAsset.values()) {
    tradesArr.sort((a, b) => a.ts - b.ts);
  }
  matchSameDay(byAsset);
  matchThirtyDay(byAsset);

  const pools = new Map<AssetSymbol, PoolState>([
    ['BTC', { totalQty: 0, totalCostGBP: 0 }],
    ['ETH', { totalQty: 0, totalCostGBP: 0 }],
    ['USDT', { totalQty: 0, totalCostGBP: 0 }]
  ]);

  const chronological = [...enrichedTrades].sort((a, b) => a.ts - b.ts);
  let closingSnapshot: Record<AssetSymbol, { totalQty: number; totalCostGBP: number; avgCostGBP: number }> | null = null;
  const snapshotAt = options.poolSnapshotAt;

  for (const trade of chronological) {
    const pool = pools.get(trade.asset)!;
    if (trade.side === 'BUY') {
      const qty = trade.remainingQty;
      if (qty > 0) {
        const cost = qty * (trade.totalCostPerUnit ?? trade.perUnitGBP);
        pool.totalQty += qty;
        pool.totalCostGBP += cost;
        trade.remainingQty = 0;
      }
    } else {
      if (trade.remainingQty > 0) {
        const qty = trade.remainingQty;
        const availableQty = pool.totalQty;
        const avgCost = availableQty > 0 ? pool.totalCostGBP / availableQty : 0;
        const matched = Math.min(qty, availableQty);
        if (matched > 0) {
          const allowable = matched * avgCost;
          applyMatch(trade, matched, 'SECTION_104', allowable);
          pool.totalQty -= matched;
          pool.totalCostGBP -= allowable;
        }
        const remainder = trade.remainingQty;
        if (remainder > 0.0000001) {
          applyMatch(trade, remainder, 'SECTION_104', 0);
          trade.issues.push('Section 104 pool exhausted for portion of disposal');
          trade.remainingQty = 0;
        }
      }
    }
    if (snapshotAt !== undefined && trade.ts <= snapshotAt) {
      closingSnapshot = clonePoolState(pools);
    }
  }
  if (!closingSnapshot) {
    closingSnapshot = clonePoolState(pools);
  }

  const windowStart = options.windowStart ?? -Infinity;
  const windowEnd = options.windowEnd ?? Infinity;
  const disposals: DisposalReport[] = [];
  const matchLines: FlatMatchLine[] = [];
  const totalsByAsset: Record<AssetSymbol, number> = { BTC: 0, ETH: 0, USDT: 0 };
  const issues: string[] = [];

  for (const trade of enrichedTrades) {
    if (trade.side !== 'SELL') {
      continue;
    }
    const report: DisposalReport = {
      sellRef: trade.id,
      ts: trade.ts,
      asset: trade.asset,
      quantity: trade.quantity,
      grossProceedsGBP: trade.grossProceedsGBP ?? 0,
      disposalFeesGBP: trade.disposalFeesGBP ?? 0,
      netProceedsGBP: trade.netProceedsGBP ?? 0,
      matches: trade.matches,
      totalGainGBP: trade.matches.reduce((acc, m) => acc + m.gainGBP, 0),
      issues: trade.issues.length ? [...trade.issues] : undefined
    };
    if (trade.issues.length) {
      issues.push(...trade.issues.map((text) => `${trade.id}: ${text}`));
    }
    if (trade.ts >= windowStart && trade.ts <= windowEnd) {
      disposals.push(report);
      totalsByAsset[trade.asset] += report.totalGainGBP;
      for (const match of trade.matches) {
        matchLines.push({ ...match, sellRef: trade.id, asset: trade.asset, ts: trade.ts });
      }
    }
  }
  const overallGain = Object.values(totalsByAsset).reduce((acc, v) => acc + v, 0);

  return {
    disposals,
    matchLines,
    pools: closingSnapshot,
    totals: { overallGainGBP: overallGain, byAsset: totalsByAsset },
    issues
  };
}

type HmrcFinalOptions = HmrcComputationOptions;
