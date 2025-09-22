import { AssetSymbol } from './types';

export type TradeLegCost = {
  feePct?: number;
  slippagePct?: number;
};

export type EffectiveParams = {
  nominalPct: number;
  legs: TradeLegCost[];
  withdrawalPct?: number;
};

export function effectiveArbPercentage({ nominalPct, legs, withdrawalPct = 0 }: EffectiveParams): number {
  const legCost = legs.reduce((acc, leg) => acc + (leg.feePct ?? 0) + (leg.slippagePct ?? 0), 0);
  return nominalPct - legCost - withdrawalPct;
}

export function slippageDeduction(legs: TradeLegCost[]): number {
  return legs.reduce((acc, leg) => acc + (leg.slippagePct ?? 0), 0);
}

export function withdrawalAmortizationPct(withdrawalFeeAsset: number, assetPriceGBP: number, notionalGBP: number): number {
  if (notionalGBP <= 0) {
    return 0;
  }
  const feeGBP = withdrawalFeeAsset * assetPriceGBP;
  return (feeGBP / notionalGBP) * 100;
}

export function percentageDifference(v1: number, v2: number): {
  absolute: number;
  relativePct: number | null;
  percentagePoints: number | null;
} {
  const absolute = v2 - v1;
  const relativePct = v1 === 0 ? null : (absolute / Math.abs(v1)) * 100;
  const percentagePoints = Number.isFinite(v1) && Number.isFinite(v2) ? v2 - v1 : null;
  return { absolute, relativePct, percentagePoints };
}

export type PositionSizerInput = {
  direction: 'KRAKEN_TO_LUNO' | 'LUNO_TO_KRAKEN';
  asset: AssetSymbol;
  balances: { lunoZAR: number; krakenGBP: number };
  caps: { lunoZAR: number; krakenGBP: number };
  prices: {
    krakenAskGBP?: number | null;
    krakenBidGBP?: number | null;
    lunoAskZAR?: number | null;
    lunoBidZAR?: number | null;
    fxGBPZAR: number;
  };
  effectivePct: number;
};

export type PositionSizerResult = {
  maxQty: number;
  maxNotionalGBP: number;
  maxNotionalZAR: number;
  estimatedPnlGBP: number;
};

export function computePositionSize(input: PositionSizerInput): PositionSizerResult | null {
  const { direction, balances, caps, prices, effectivePct } = input;
  const lunoCapZAR = Math.min(balances.lunoZAR, caps.lunoZAR);
  const krakenCapGBP = Math.min(balances.krakenGBP, caps.krakenGBP);
  if (direction === 'KRAKEN_TO_LUNO') {
    if (!prices.krakenAskGBP || !prices.lunoBidZAR) {
      return null;
    }
    const maxQtyByKraken = krakenCapGBP / prices.krakenAskGBP;
    const maxQtyByLuno = lunoCapZAR / prices.lunoBidZAR;
    const maxQty = Math.max(0, Math.min(maxQtyByKraken, maxQtyByLuno));
    const maxNotionalGBP = maxQty * prices.krakenAskGBP;
    const maxNotionalZAR = maxNotionalGBP * prices.fxGBPZAR;
    const estimatedPnlGBP = (maxNotionalGBP * effectivePct) / 100;
    return { maxQty, maxNotionalGBP, maxNotionalZAR, estimatedPnlGBP };
  }
  if (!prices.lunoAskZAR || !prices.krakenBidGBP) {
    return null;
  }
  const maxQtyByLuno = lunoCapZAR / prices.lunoAskZAR;
  const maxQtyByKraken = krakenCapGBP / prices.krakenBidGBP;
  const maxQty = Math.max(0, Math.min(maxQtyByLuno, maxQtyByKraken));
  const maxNotionalGBP = maxQty * prices.krakenBidGBP;
  const maxNotionalZAR = maxNotionalGBP * prices.fxGBPZAR;
  const estimatedPnlGBP = (maxNotionalGBP * effectivePct) / 100;
  return { maxQty, maxNotionalGBP, maxNotionalZAR, estimatedPnlGBP };
}

export function guardNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return value;
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
