import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { effectiveArbPercentage, withdrawalAmortizationPct } from '../lib/calc';
import { Sample, AssetSymbol } from '../lib/types';
import { LocalSettings } from '../hooks/useLocalSettings';

const AGG_OPTIONS = [
  { label: '1m', minutes: 1 },
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 }
];

type AssetChartProps = {
  asset: AssetSymbol;
  samples: Sample[];
  settings: LocalSettings;
  onExplain: (payload: { asset: AssetSymbol; sample: Sample }) => void;
};

function aggregate(samples: Sample[], minutes: number): Sample[] {
  if (minutes <= 1) {
    return samples;
  }
  const bucketMs = minutes * 60 * 1000;
  const buckets = new Map<number, Sample>();
  for (const sample of samples) {
    const bucket = Math.floor(sample.ts / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    if (!existing || sample.ts > existing.ts) {
      buckets.set(bucket, sample);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
}

function computeEffective(sample: Sample, asset: AssetSymbol, settings: LocalSettings) {
  const snapshot = sample[asset];
  const slippage = settings.slippageCaps[asset];
  const fees = {
    kraken: settings.fees.kraken[asset].taker,
    luno: settings.fees.luno[asset].taker
  };
  const withdrawalKraken = settings.withdrawalFees[asset].kraken;
  const withdrawalLuno = settings.withdrawalFees[asset].luno;
  const notionalGBP = settings.balances.krakenGBP;
  const notionalGBP2 = settings.balances.lunoZAR / sample.fx_gbp_zar;
  const withdrawalKrakenPct = settings.withdrawalAmortization && snapshot.krakenAskGBP
    ? withdrawalAmortizationPct(withdrawalKraken, snapshot.krakenAskGBP, notionalGBP)
    : 0;
  const withdrawalLunoPct = settings.withdrawalAmortization && snapshot.krakenBidGBP
    ? withdrawalAmortizationPct(withdrawalLuno, snapshot.krakenBidGBP, notionalGBP2)
    : 0;
  const kToLNominal = snapshot.arb_buyKraken_sellLuno_pct ?? null;
  const lToKNominal = snapshot.arb_buyLuno_sellKraken_pct ?? null;
  const kToL =
    kToLNominal === null
      ? null
      : effectiveArbPercentage({
          nominalPct: kToLNominal,
          legs: [
            { feePct: fees.kraken, slippagePct: slippage },
            { feePct: fees.luno, slippagePct: slippage }
          ],
          withdrawalPct: withdrawalKrakenPct
        });
  const lToK =
    lToKNominal === null
      ? null
      : effectiveArbPercentage({
          nominalPct: lToKNominal,
          legs: [
            { feePct: fees.luno, slippagePct: slippage },
            { feePct: fees.kraken, slippagePct: slippage }
          ],
          withdrawalPct: withdrawalLunoPct
        });
  return { kToL, lToK, kToLNominal, lToKNominal };
}

export function AssetChart({ asset, samples, settings, onExplain }: AssetChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [agg, setAgg] = useState(AGG_OPTIONS[1]);

  const data = useMemo(() => {
    const aggregated = aggregate(samples, agg.minutes);
    const times = aggregated.map((s) => s.ts / 1000);
    const lunoBid = aggregated.map((s) => s[asset].lunoBestBidZAR ?? null);
    const lunoAsk = aggregated.map((s) => s[asset].lunoBestAskZAR ?? null);
    const krakenBidGBP = aggregated.map((s) => s[asset].krakenBidGBP ?? null);
    const krakenAskGBP = aggregated.map((s) => s[asset].krakenAskGBP ?? null);
    const krakenBidZAR = aggregated.map((s) => s[asset].krakenBidZAR ?? null);
    const krakenAskZAR = aggregated.map((s) => s[asset].krakenAskZAR ?? null);
    const effectiveK = aggregated.map((s) => computeEffective(s, asset, settings).kToL);
    const effectiveL = aggregated.map((s) => computeEffective(s, asset, settings).lToK);
    const nominalK = aggregated.map((s) => computeEffective(s, asset, settings).kToLNominal);
    const nominalL = aggregated.map((s) => computeEffective(s, asset, settings).lToKNominal);
    return {
      aggregated,
      series: [times, lunoBid, lunoAsk, krakenBidGBP, krakenAskGBP, krakenBidZAR, krakenAskZAR, nominalK, nominalL, effectiveK, effectiveL]
    };
  }, [samples, agg, asset, settings]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const options: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: 320,
      title: `${asset} orderbook & arbitrage`,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Europe/London'),
      scales: {
        x: { time: true },
        price: { auto: true },
        percent: { auto: true }
      },
      series: [
        {},
        { label: 'Luno Bid (ZAR)', scale: 'price', stroke: '#38bdf8' },
        { label: 'Luno Ask (ZAR)', scale: 'price', stroke: '#0ea5e9' },
        { label: 'Kraken Bid (GBP)', scale: 'price', stroke: '#f97316' },
        { label: 'Kraken Ask (GBP)', scale: 'price', stroke: '#fb923c' },
        { label: 'Kraken Bid (ZAR)', scale: 'price', stroke: '#22c55e' },
        { label: 'Kraken Ask (ZAR)', scale: 'price', stroke: '#16a34a' },
        { label: 'Nominal K→L %', scale: 'percent', stroke: '#fbbf24' },
        { label: 'Nominal L→K %', scale: 'percent', stroke: '#fde68a' },
        { label: 'Effective K→L %', scale: 'percent', stroke: '#f43f5e' },
        { label: 'Effective L→K %', scale: 'percent', stroke: '#fda4af' }
      ]
    };
    plotRef.current = new uPlot(options, data.series, containerRef.current);
    const handleResize = () => {
      if (containerRef.current && plotRef.current) {
        plotRef.current.setSize({ width: containerRef.current.clientWidth, height: 320 });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  useEffect(() => {
    if (plotRef.current) {
      plotRef.current.setData(data.series);
    }
  }, [data]);

  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{asset} chart</h3>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor={`${asset}-agg`}>Aggregation</label>
          <select
            id={`${asset}-agg`}
            value={agg.minutes}
            onChange={(event) => {
              const minutes = Number(event.target.value);
              const next = AGG_OPTIONS.find((opt) => opt.minutes === minutes) ?? AGG_OPTIONS[0];
              setAgg(next);
            }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            {AGG_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const latest = data.aggregated[data.aggregated.length - 1];
              if (latest) {
                onExplain({ asset, sample: latest });
              }
            }}
            className="bg-slate-700 hover:bg-slate-600"
          >
            Explain spike
          </button>
        </div>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden" />
    </section>
  );
}

export default AssetChart;
