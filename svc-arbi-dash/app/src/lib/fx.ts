export function convertGBPToZAR(amount: number, fx: number): number {
  return amount * fx;
}

export function convertZARToGBP(amount: number, fx: number): number {
  if (fx === 0) {
    throw new Error('FX rate must be non-zero');
  }
  return amount / fx;
}

export function convertZARToUSD(amount: number, zarUsd: number): number {
  if (zarUsd === 0) {
    throw new Error('FX rate must be non-zero');
  }
  return amount / zarUsd;
}

export function convertUSDToZAR(amount: number, zarUsd: number): number {
  return amount * zarUsd;
}

export type FrankfurterQuote = {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
};
