import { useMemo, useState } from 'react';
import { percentageDifference } from '../lib/calc';
import { convertGBPToZAR, convertZARToGBP, convertUSDToZAR, convertZARToUSD } from '../lib/fx';
import { FxQuote } from '../hooks/useFrankfurter';

interface CalculatorsProps {
  quotes: Record<'GBPZAR' | 'USDZAR', FxQuote | null>;
}

export function Calculators({ quotes }: CalculatorsProps) {
  const [v1, setV1] = useState(0);
  const [v2, setV2] = useState(0);
  const [zarValue, setZarValue] = useState(0);
  const [gbpValue, setGbpValue] = useState(0);
  const [usdValue, setUsdValue] = useState(0);

  const diff = useMemo(() => percentageDifference(v1, v2), [v1, v2]);

  const gbpZarRate = quotes.GBPZAR?.rate ?? null;
  const usdZarRate = quotes.USDZAR?.rate ?? null;

  const converted = useMemo(() => {
    if (!gbpZarRate || !usdZarRate) {
      return null;
    }
    return {
      zarToGbp: convertZARToGBP(zarValue, gbpZarRate),
      gbpToZar: convertGBPToZAR(gbpValue, gbpZarRate),
      zarToUsd: convertZARToUSD(zarValue, usdZarRate),
      usdToZar: convertUSDToZAR(usdValue, usdZarRate)
    };
  }, [zarValue, gbpValue, usdValue, gbpZarRate, usdZarRate]);

  return (
    <section className="card p-4 space-y-4">
      <h3 className="text-lg font-semibold">Calculators</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="font-semibold">Percentage difference</h4>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="diff-v1" className="w-24">
              Value 1
            </label>
            <input id="diff-v1" type="number" value={v1} onChange={(event) => setV1(Number(event.target.value))} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="diff-v2" className="w-24">
              Value 2
            </label>
            <input id="diff-v2" type="number" value={v2} onChange={(event) => setV2(Number(event.target.value))} />
          </div>
          <p className="text-xs text-slate-300">Absolute difference: {diff.absolute.toFixed(4)}</p>
          <p className="text-xs text-slate-300">
            Relative %: {diff.relativePct === null ? 'undefined (v1 = 0)' : `${diff.relativePct.toFixed(4)}%`}
          </p>
          <p className="text-xs text-slate-300">
            Percentage points: {diff.percentagePoints === null ? 'n/a' : diff.percentagePoints.toFixed(4)}
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="font-semibold">FX converters</h4>
          <p className="text-xs text-slate-400">
            GBP↔ZAR quote: {gbpZarRate ? gbpZarRate.toFixed(4) : 'loading…'} · USD↔ZAR quote: {usdZarRate ? usdZarRate.toFixed(4) : 'loading…'}
          </p>
          <p className="text-xs text-slate-500">
            Last update: {quotes.GBPZAR ? new Date(quotes.GBPZAR.fetchedAt).toLocaleString('en-GB', { hour12: false }) : '—'}
          </p>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="zar-value" className="w-24">
              ZAR
            </label>
            <input id="zar-value" type="number" value={zarValue} onChange={(event) => setZarValue(Number(event.target.value))} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="gbp-value" className="w-24">
              GBP
            </label>
            <input id="gbp-value" type="number" value={gbpValue} onChange={(event) => setGbpValue(Number(event.target.value))} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="usd-value" className="w-24">
              USD
            </label>
            <input id="usd-value" type="number" value={usdValue} onChange={(event) => setUsdValue(Number(event.target.value))} />
          </div>
          {converted ? (
            <div className="text-xs text-slate-300 space-y-1">
              <div>ZAR → GBP: £{converted.zarToGbp.toFixed(2)}</div>
              <div>GBP → ZAR: R{converted.gbpToZar.toFixed(2)}</div>
              <div>ZAR → USD: ${converted.zarToUsd.toFixed(2)}</div>
              <div>USD → ZAR: R{converted.usdToZar.toFixed(2)}</div>
            </div>
          ) : (
            <p className="text-xs text-amber-400">Waiting for FX quotes…</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default Calculators;
