import { useMemo, useState } from 'react';
import { computePositionSize, effectiveArbPercentage, PositionSizerInput } from '../lib/calc';
import { Sample, AssetSymbol } from '../lib/types';
import { LocalSettings } from '../hooks/useLocalSettings';

const ASSETS: AssetSymbol[] = ['ETH', 'BTC', 'USDT'];

type PositionSizerProps = {
  sample: Sample | null;
  settings: LocalSettings;
};

export function PositionSizer({ sample, settings }: PositionSizerProps) {
  const [lunoCap, setLunoCap] = useState(settings.balances.lunoZAR);
  const [krakenCap, setKrakenCap] = useState(settings.balances.krakenGBP);

  const rows = useMemo(() => {
    if (!sample) {
      return [];
    }
   return ASSETS.map((asset) => {
      const snapshot = sample[asset];
      const slippage = settings.slippageCaps[asset];
      const fees = {
        kraken: settings.fees.kraken[asset].taker,
        luno: settings.fees.luno[asset].taker
      };
      const nominalK = snapshot.arb_buyKraken_sellLuno_pct ?? 0;
      const nominalL = snapshot.arb_buyLuno_sellKraken_pct ?? 0;
      const effectiveK = effectiveArbPercentage({
        nominalPct: nominalK,
        legs: [
          { feePct: fees.kraken, slippagePct: slippage },
          { feePct: fees.luno, slippagePct: slippage }
        ]
      });
      const effectiveL = effectiveArbPercentage({
        nominalPct: nominalL,
        legs: [
          { feePct: fees.luno, slippagePct: slippage },
          { feePct: fees.kraken, slippagePct: slippage }
        ]
      });
      const inputBase: Omit<PositionSizerInput, 'direction'> = {
        asset,
        balances: settings.balances,
        caps: { lunoZAR: lunoCap, krakenGBP: krakenCap },
        prices: {
          krakenAskGBP: snapshot.krakenAskGBP,
          krakenBidGBP: snapshot.krakenBidGBP,
          lunoAskZAR: snapshot.lunoBestAskZAR,
          lunoBidZAR: snapshot.lunoBestBidZAR,
          fxGBPZAR: sample.fx_gbp_zar
        },
        effectivePct: 0
      };
      const kToL = computePositionSize({ ...inputBase, direction: 'KRAKEN_TO_LUNO', effectivePct: effectiveK });
      const lToK = computePositionSize({ ...inputBase, direction: 'LUNO_TO_KRAKEN', effectivePct: effectiveL });
      return { asset, kToL, lToK };
    });
  }, [sample, settings.balances, lunoCap, krakenCap]);

  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Position sizer</h3>
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-2">
            Luno cap (ZAR)
            <input type="number" value={lunoCap} onChange={(event) => setLunoCap(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-2">
            Kraken cap (GBP)
            <input type="number" value={krakenCap} onChange={(event) => setKrakenCap(Number(event.target.value))} />
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-right">K→L Notional (GBP)</th>
              <th className="px-3 py-2 text-right">K→L P&amp;L (GBP)</th>
              <th className="px-3 py-2 text-right">L→K Notional (GBP)</th>
              <th className="px-3 py-2 text-right">L→K P&amp;L (GBP)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.asset} className="odd:bg-slate-900/40">
                <td className="px-3 py-2">{row.asset}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.kToL ? row.kToL.maxNotionalGBP.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-400">
                  {row.kToL ? row.kToL.estimatedPnlGBP.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.lToK ? row.lToK.maxNotionalGBP.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-emerald-400">
                  {row.lToK ? row.lToK.estimatedPnlGBP.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default PositionSizer;
