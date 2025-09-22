import { useMemo, useState } from 'react';
import { Sample, AssetSymbol } from '../lib/types';
import { formatDateTime } from '../lib/time';
import { LocalSettings } from '../hooks/useLocalSettings';
import { effectiveArbPercentage, withdrawalAmortizationPct } from '../lib/calc';
import ExportCsvButton from './ExportCsvButton';

const MAX_ROWS = 50;
const ASSETS: AssetSymbol[] = ['ETH', 'BTC', 'USDT'];

type RecentTableProps = {
  samples: Sample[];
  settings: LocalSettings;
};

export function RecentTable({ samples, settings }: RecentTableProps) {
  const [assetFilter, setAssetFilter] = useState<'ALL' | AssetSymbol>('ALL');
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [threshold, setThreshold] = useState(0);
  const [rowsToShow, setRowsToShow] = useState(MAX_ROWS);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(() => {
    const slice = sortDir === 'desc' ? [...samples].reverse() : [...samples];
    const selected = slice.slice(-rowsToShow);
    return selected
      .map((sample) => {
        const perAssetEntries = ASSETS.map((asset) => {
          const snapshot = sample[asset];
          const slippage = settings.slippageCaps[asset];
          const fees = {
            kraken: settings.fees.kraken[asset].taker,
            luno: settings.fees.luno[asset].taker
          };
          const withdrawalK = settings.withdrawalAmortization && snapshot.krakenAskGBP
            ? withdrawalAmortizationPct(
                settings.withdrawalFees[asset].kraken,
                snapshot.krakenAskGBP,
                settings.balances.krakenGBP
              )
            : 0;
          const withdrawalL = settings.withdrawalAmortization && snapshot.krakenBidGBP
            ? withdrawalAmortizationPct(
                settings.withdrawalFees[asset].luno,
                snapshot.krakenBidGBP,
                settings.balances.lunoZAR / sample.fx_gbp_zar
              )
            : 0;
          const nominalK = snapshot.arb_buyKraken_sellLuno_pct;
          const nominalL = snapshot.arb_buyLuno_sellKraken_pct;
          const effectiveK =
            nominalK === null
              ? null
              : effectiveArbPercentage({
                  nominalPct: nominalK,
                  legs: [
                    { feePct: fees.kraken, slippagePct: slippage },
                    { feePct: fees.luno, slippagePct: slippage }
                  ],
                  withdrawalPct: withdrawalK
                });
          const effectiveL =
            nominalL === null
              ? null
              : effectiveArbPercentage({
                  nominalPct: nominalL,
                  legs: [
                    { feePct: fees.luno, slippagePct: slippage },
                    { feePct: fees.kraken, slippagePct: slippage }
                  ],
                  withdrawalPct: withdrawalL
                });
          return [
            asset,
            {
              snapshot,
              nominalK,
              nominalL,
              effectiveK,
              effectiveL
            }
          ];
        });
        const perAsset = Object.fromEntries(perAssetEntries) as Record<
          AssetSymbol,
          {
            snapshot: Sample['ETH'];
            nominalK: number | null;
            nominalL: number | null;
            effectiveK: number | null;
            effectiveL: number | null;
          }
        >;
        return {
          ts: sample.ts,
          fx: sample.fx_gbp_zar,
          perAsset
        };
      })
      .filter((row) => {
        if (assetFilter === 'ALL') {
          return true;
        }
        const data = row.perAsset[assetFilter];
        if (!profitableOnly) {
          return true;
        }
        const effective = Math.max(data.effectiveK ?? -Infinity, data.effectiveL ?? -Infinity);
        return effective >= threshold;
      });
  }, [samples, settings, assetFilter, profitableOnly, threshold, rowsToShow, sortDir]);

  const csvRows = useMemo(() => {
    return rows.map((row) => ({
      ts_epoch: row.ts,
      ts_local: formatDateTime(row.ts),
      fx_gbp_zar: row.fx,
      ETH_nominal_KL: row.perAsset.ETH.nominalK ?? '',
      ETH_nominal_LK: row.perAsset.ETH.nominalL ?? '',
      ETH_effective_KL: row.perAsset.ETH.effectiveK ?? '',
      ETH_effective_LK: row.perAsset.ETH.effectiveL ?? '',
      BTC_nominal_KL: row.perAsset.BTC.nominalK ?? '',
      BTC_nominal_LK: row.perAsset.BTC.nominalL ?? '',
      BTC_effective_KL: row.perAsset.BTC.effectiveK ?? '',
      BTC_effective_LK: row.perAsset.BTC.effectiveL ?? '',
      USDT_nominal_KL: row.perAsset.USDT.nominalK ?? '',
      USDT_nominal_LK: row.perAsset.USDT.nominalL ?? '',
      USDT_effective_KL: row.perAsset.USDT.effectiveK ?? '',
      USDT_effective_LK: row.perAsset.USDT.effectiveL ?? ''
    }));
  }, [rows]);

  return (
    <section className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="asset-filter">Asset</label>
          <select
            id="asset-filter"
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
            value={assetFilter}
            onChange={(event) => setAssetFilter(event.target.value as 'ALL' | AssetSymbol)}
          >
            <option value="ALL">All</option>
            {ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={profitableOnly}
            onChange={(event) => setProfitableOnly(event.target.checked)}
          />
          Profitable only (≥ threshold)
        </label>
        <input
          type="number"
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
          className="w-20"
        />
        <label className="flex items-center gap-2">
          Rows
          <input
            type="number"
            min={10}
            max={500}
            value={rowsToShow}
            onChange={(event) => setRowsToShow(Number(event.target.value))}
            className="w-20"
          />
        </label>
        <button
          onClick={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          className="bg-slate-700 hover:bg-slate-600"
        >
          Sort {sortDir === 'asc' ? '▲' : '▼'}
        </button>
        <ExportCsvButton filename="recent-samples.csv" rows={csvRows} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Time (UK)</th>
              <th className="px-3 py-2 text-right">FX GBP→ZAR</th>
              {ASSETS.map((asset) => (
                <th key={asset} className="px-3 py-2 text-left">
                  {asset}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ts} className="odd:bg-slate-900/40">
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.ts)}</td>
                <td className="px-3 py-2 text-right font-mono">{row.fx.toFixed(3)}</td>
                {ASSETS.map((asset) => {
                  const data = row.perAsset[asset];
                  const best = Math.max(data.effectiveK ?? -Infinity, data.effectiveL ?? -Infinity);
                  const bestDisplay = Number.isFinite(best) ? best.toFixed(2) : '—';
                  return (
                    <td key={asset} className="px-3 py-2 align-top whitespace-nowrap">
                      <div>Nominal K→L: {data.nominalK?.toFixed(2) ?? '—'}%</div>
                      <div>Nominal L→K: {data.nominalL?.toFixed(2) ?? '—'}%</div>
                      <div>Effective K→L: {data.effectiveK?.toFixed(2) ?? '—'}%</div>
                      <div>Effective L→K: {data.effectiveL?.toFixed(2) ?? '—'}%</div>
                      <div className={best >= threshold ? 'text-emerald-400' : 'text-slate-400'}>Top: {bestDisplay}%</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default RecentTable;
