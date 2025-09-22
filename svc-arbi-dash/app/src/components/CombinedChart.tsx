import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import { Sample, AssetSymbol } from '../lib/types';
import { LocalSettings } from '../hooks/useLocalSettings';
import { effectiveArbPercentage, withdrawalAmortizationPct } from '../lib/calc';

const ASSETS: AssetSymbol[] = ['ETH', 'BTC', 'USDT'];

type CombinedChartProps = {
  samples: Sample[];
  settings: LocalSettings;
  onExplain: (payload: { asset: AssetSymbol; sample: Sample }) => void;
};

function computeTopDirection(sample: Sample, asset: AssetSymbol, settings: LocalSettings) {
  const snapshot = sample[asset];
  const slippage = settings.slippageCaps[asset];
  const fees = {
    kraken: settings.fees.kraken[asset].taker,
    luno: settings.fees.luno[asset].taker
  };
  const withdrawalK = settings.withdrawalAmortization && snapshot.krakenAskGBP
    ? withdrawalAmortizationPct(settings.withdrawalFees[asset].kraken, snapshot.krakenAskGBP, settings.balances.krakenGBP)
    : 0;
  const withdrawalL = settings.withdrawalAmortization && snapshot.krakenBidGBP
    ? withdrawalAmortizationPct(
        settings.withdrawalFees[asset].luno,
        snapshot.krakenBidGBP,
        settings.balances.lunoZAR / sample.fx_gbp_zar
      )
    : 0;
  const directions = [
    {
      direction: 'K→L',
      nominal: snapshot.arb_buyKraken_sellLuno_pct,
      effective:
        snapshot.arb_buyKraken_sellLuno_pct === null
          ? null
          : effectiveArbPercentage({
              nominalPct: snapshot.arb_buyKraken_sellLuno_pct,
              legs: [
                { feePct: fees.kraken, slippagePct: slippage },
                { feePct: fees.luno, slippagePct: slippage }
              ],
              withdrawalPct: withdrawalK
            })
    },
    {
      direction: 'L→K',
      nominal: snapshot.arb_buyLuno_sellKraken_pct,
      effective:
        snapshot.arb_buyLuno_sellKraken_pct === null
          ? null
          : effectiveArbPercentage({
              nominalPct: snapshot.arb_buyLuno_sellKraken_pct,
              legs: [
                { feePct: fees.luno, slippagePct: slippage },
                { feePct: fees.kraken, slippagePct: slippage }
              ],
              withdrawalPct: withdrawalL
            })
    }
  ];
  const best = directions.sort((a, b) => (b.effective ?? -Infinity) - (a.effective ?? -Infinity))[0];
  return best ?? null;
}

export function CombinedChart({ samples, settings, onExplain }: CombinedChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [overlayAsset, setOverlayAsset] = useState<AssetSymbol>('ETH');

  const data = useMemo(() => {
    const times = samples.map((s) => s.ts / 1000);
    const fx = samples.map((s) => s.fx_gbp_zar);
    const effectiveSeries = ASSETS.map((asset) =>
      samples.map((sample) => {
        const best = computeTopDirection(sample, asset, settings);
        return best?.effective ?? null;
      })
    );
    const overlaySeries = samples.map((sample) => ({
      lunoBid: sample[overlayAsset].lunoBestBidZAR,
      krakenAsk: sample[overlayAsset].krakenAskZAR
    }));
    return { times, fx, effectiveSeries, overlaySeries };
  }, [samples, settings, overlayAsset]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const series: uPlot.Series[] = [
      {},
      { label: 'ETH', scale: 'percent', stroke: '#f97316' },
      { label: 'BTC', scale: 'percent', stroke: '#38bdf8' },
      { label: 'USDT', scale: 'percent', stroke: '#a855f7' },
      { label: 'FX GBP→ZAR', scale: 'fx', stroke: '#facc15' },
      { label: 'Luno Bid (ZAR)', scale: 'price', stroke: '#22d3ee', show: false },
      { label: 'Kraken Ask (ZAR)', scale: 'price', stroke: '#f87171', show: false }
    ];
    const options: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: 340,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Europe/London'),
      scales: {
        x: { time: true },
        percent: { auto: true },
        fx: { auto: true },
        price: { auto: true }
      },
      series
    };
    plotRef.current = new uPlot(options, [data.times, ...data.effectiveSeries, data.fx, data.overlaySeries.map((o) => o.lunoBid ?? null), data.overlaySeries.map((o) => o.krakenAsk ?? null)], containerRef.current);
    const handleResize = () => {
      if (containerRef.current && plotRef.current) {
        plotRef.current.setSize({ width: containerRef.current.clientWidth, height: 340 });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      plotRef.current?.destroy();
      plotRef.current = null;
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!plotRef.current) {
      return;
    }
    const overlayLuno = data.overlaySeries.map((o) => o.lunoBid ?? null);
    const overlayKraken = data.overlaySeries.map((o) => o.krakenAsk ?? null);
    plotRef.current.setData([data.times, ...data.effectiveSeries, data.fx, overlayLuno, overlayKraken]);
  }, [data]);

  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Combined effective arbitrage</h3>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="overlay-select">Overlay asset legs</label>
          <select
            id="overlay-select"
            value={overlayAsset}
            onChange={(event) => setOverlayAsset(event.target.value as AssetSymbol)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            {ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
          <button
            className="bg-slate-700 hover:bg-slate-600"
            onClick={() => {
              const latest = samples[samples.length - 1];
              if (latest) {
                onExplain({ asset: overlayAsset, sample: latest });
              }
            }}
          >
            Explain spike
          </button>
        </div>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden" />
    </section>
  );
}

export default CombinedChart;
