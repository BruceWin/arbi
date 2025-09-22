import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { computeHmrc } from '../app/src/lib/hmrc';
import { Trade } from '../app/src/lib/types';

function tradeFactory(options: {
  id: string;
  ts: DateTime;
  asset: 'ETH' | 'BTC' | 'USDT';
  side: 'BUY' | 'SELL';
  quantity: number;
  priceGBP: number;
  feeGBP?: number;
}): Trade {
  const tsMillis = options.ts.toMillis();
  const proceeds = options.priceGBP * options.quantity;
  return {
    id: options.id,
    ts: tsMillis,
    asset: options.asset,
    side: options.side,
    quantity: options.quantity,
    priceGBP: options.priceGBP,
    priceZAR: undefined,
    fx_gbp_zar: undefined,
    fee: options.feeGBP ? { amount: options.feeGBP, currency: 'GBP' } : undefined,
    derived: {
      perUnitGBP: options.priceGBP,
      gbpProceedsOrCost: proceeds,
      feeGBP: options.feeGBP,
      fxSource: 'USER'
    }
  };
}

describe('HMRC computation', () => {
  it('prioritises same-day matches', () => {
    const buy = tradeFactory({
      id: 'b1',
      ts: DateTime.fromISO('2024-05-01T10:00', { zone: 'Europe/London' }),
      asset: 'ETH',
      side: 'BUY',
      quantity: 1,
      priceGBP: 1000
    });
    const sell = tradeFactory({
      id: 's1',
      ts: DateTime.fromISO('2024-05-01T18:00', { zone: 'Europe/London' }),
      asset: 'ETH',
      side: 'SELL',
      quantity: 1,
      priceGBP: 1200
    });
    const report = computeHmrc([buy, sell], {
      windowStart: buy.ts - 1,
      windowEnd: sell.ts + 1,
      poolSnapshotAt: sell.ts
    });
    expect(report.disposals).toHaveLength(1);
    expect(report.disposals[0].matches[0].rule).toBe('SAME_DAY');
    expect(report.disposals[0].matches[0].gainGBP).toBeCloseTo(200, 5);
  });

  it('matches within 30 days for future buys', () => {
    const sell = tradeFactory({
      id: 's1',
      ts: DateTime.fromISO('2024-06-01T10:00', { zone: 'Europe/London' }),
      asset: 'BTC',
      side: 'SELL',
      quantity: 0.5,
      priceGBP: 20000
    });
    const buy = tradeFactory({
      id: 'b1',
      ts: DateTime.fromISO('2024-06-20T12:00', { zone: 'Europe/London' }),
      asset: 'BTC',
      side: 'BUY',
      quantity: 0.5,
      priceGBP: 18000
    });
    const report = computeHmrc([sell, buy], {
      windowStart: sell.ts - 1,
      windowEnd: buy.ts + 1,
      poolSnapshotAt: buy.ts
    });
    expect(report.disposals[0].matches[0].rule).toBe('WITHIN_30_DAYS');
    expect(report.disposals[0].matches[0].matchedQty).toBeCloseTo(0.5, 6);
  });

  it('falls back to Section 104 pool', () => {
    const buy1 = tradeFactory({
      id: 'b1',
      ts: DateTime.fromISO('2023-01-01T09:00', { zone: 'Europe/London' }),
      asset: 'USDT',
      side: 'BUY',
      quantity: 1000,
      priceGBP: 0.8
    });
    const buy2 = tradeFactory({
      id: 'b2',
      ts: DateTime.fromISO('2023-03-01T09:00', { zone: 'Europe/London' }),
      asset: 'USDT',
      side: 'BUY',
      quantity: 1000,
      priceGBP: 0.82
    });
    const sell = tradeFactory({
      id: 's1',
      ts: DateTime.fromISO('2024-01-01T09:00', { zone: 'Europe/London' }),
      asset: 'USDT',
      side: 'SELL',
      quantity: 1500,
      priceGBP: 0.9
    });
    const report = computeHmrc([buy1, buy2, sell], {
      windowStart: buy1.ts,
      windowEnd: sell.ts,
      poolSnapshotAt: sell.ts
    });
    expect(report.disposals[0].matches[0].rule).toBe('SECTION_104');
    const allowable = report.disposals[0].matches[0].allowableCostGBP;
    expect(allowable).toBeGreaterThan(0);
    expect(report.pools.USDT.totalQty).toBeGreaterThanOrEqual(500);
  });
});
