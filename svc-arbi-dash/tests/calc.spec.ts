import { describe, expect, it } from 'vitest';
import {
  effectiveArbPercentage,
  slippageDeduction,
  withdrawalAmortizationPct,
  percentageDifference
} from '../app/src/lib/calc';

describe('calc utilities', () => {
  it('computes effective arbitrage with fees and slippage', () => {
    const effective = effectiveArbPercentage({
      nominalPct: 5,
      legs: [
        { feePct: 0.6, slippagePct: 0.1 },
        { feePct: 0.4, slippagePct: 0.1 }
      ],
      withdrawalPct: 0.5
    });
    expect(effective).toBeCloseTo(3.4, 5);
  });

  it('aggregates slippage deduction', () => {
    const total = slippageDeduction([
      { slippagePct: 0.1 },
      { slippagePct: 0.2 }
    ]);
    expect(total).toBeCloseTo(0.3, 5);
  });

  it('computes withdrawal amortization percentage', () => {
    const pct = withdrawalAmortizationPct(0.0002, 2000, 10000);
    expect(pct).toBeCloseTo(0.004, 6);
  });

  it('computes percentage differences with guard', () => {
    const diff = percentageDifference(10, 12);
    expect(diff.absolute).toBe(2);
    expect(diff.relativePct).toBeCloseTo(20, 5);
    expect(diff.percentagePoints).toBe(2);
    const diffZero = percentageDifference(0, 5);
    expect(diffZero.relativePct).toBeNull();
  });
});
