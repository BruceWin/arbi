import { useMemo, useState } from 'react';
import { useTradesApi } from '../hooks/useTradesApi';
import { formatDateTime, parseUkDate } from '../lib/time';
import { Trade, AssetSymbol, TradeSide } from '../lib/types';
import ExportCsvButton from './ExportCsvButton';

interface TradesTableProps {
  api: ReturnType<typeof useTradesApi>;
  onEdit: (trade: Trade) => void;
}

const ASSETS: Array<'ALL' | AssetSymbol> = ['ALL', 'ETH', 'BTC', 'USDT'];
const SIDES: Array<'ALL' | TradeSide> = ['ALL', 'BUY', 'SELL'];

export function TradesTable({ api, onEdit }: TradesTableProps) {
  const { trades, status, error, filters, setFilters, loadMore, hasMore, remove, lock, refresh } = api;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const csvRows = useMemo(() => {
    return trades.map((trade) => ({
      id: trade.id,
      ts_epoch: trade.ts,
      ts_local: formatDateTime(trade.ts),
      asset: trade.asset,
      side: trade.side,
      quantity: trade.quantity,
      per_unit_gbp: trade.derived?.perUnitGBP ?? trade.priceGBP ?? '',
      fx_gbp_zar: trade.fx_gbp_zar ?? '',
      proceeds_gbp: trade.derived?.gbpProceedsOrCost ?? '',
      fee_gbp: trade.derived?.feeGBP ?? '',
      venue: trade.venue ?? '',
      notes: trade.notes ?? '',
      locked: trade.locked ?? false
    }));
  }, [trades]);

  const toggleSelection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="trade-asset">Asset</label>
          <select
            id="trade-asset"
            value={filters.asset ?? 'ALL'}
            onChange={(event) => setFilters((prev) => ({ ...prev, asset: event.target.value === 'ALL' ? undefined : (event.target.value as AssetSymbol) }))}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            {ASSETS.map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="trade-side">Side</label>
          <select
            id="trade-side"
            value={filters.side ?? 'ALL'}
            onChange={(event) => setFilters((prev) => ({ ...prev, side: event.target.value === 'ALL' ? undefined : (event.target.value as TradeSide) }))}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1"
          >
            {SIDES.map((side) => (
              <option key={side} value={side}>
                {side}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          From
          <input
            type="date"
            value={filters.from ? new Date(filters.from).toISOString().slice(0, 10) : ''}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, from: event.target.value ? parseUkDate(event.target.value) : undefined }))
            }
          />
        </label>
        <label className="flex items-center gap-2">
          To
          <input
            type="date"
            value={filters.to ? new Date(filters.to).toISOString().slice(0, 10) : ''}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, to: event.target.value ? parseUkDate(event.target.value) : undefined }))
            }
          />
        </label>
        <button onClick={refresh} className="bg-slate-700 hover:bg-slate-600">
          Refresh
        </button>
        <button
          onClick={async () => {
            await lock(Array.from(selected));
            setSelected(new Set());
          }}
          className="bg-emerald-700 hover:bg-emerald-600"
          disabled={selected.size === 0}
        >
          Lock selected
        </button>
        <ExportCsvButton filename="trades.csv" rows={csvRows} />
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-900 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Select</th>
              <th className="px-3 py-2 text-left">Time (UK)</th>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-left">Side</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">GBP</th>
              <th className="px-3 py-2 text-right">ZAR</th>
              <th className="px-3 py-2 text-right">FX</th>
              <th className="px-3 py-2 text-right">GBP proceeds</th>
              <th className="px-3 py-2 text-right">Fee GBP</th>
              <th className="px-3 py-2 text-left">Venue</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id} className={`odd:bg-slate-900/40 ${trade.locked ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(trade.id)}
                    onChange={() => toggleSelection(trade.id)}
                    disabled={trade.locked}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(trade.ts)}</td>
                <td className="px-3 py-2">{trade.asset}</td>
                <td className="px-3 py-2">{trade.side}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.quantity.toFixed(6)}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.priceGBP ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.priceZAR ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.fx_gbp_zar ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.derived?.gbpProceedsOrCost?.toFixed(2) ?? '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{trade.derived?.feeGBP?.toFixed(2) ?? '—'}</td>
                <td className="px-3 py-2">{trade.venue ?? '—'}</td>
                <td className="px-3 py-2 max-w-xs truncate" title={trade.notes ?? ''}>
                  {trade.notes ?? '—'}
                </td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    className="bg-slate-700 hover:bg-slate-600"
                    onClick={() => onEdit(trade)}
                    disabled={trade.locked}
                  >
                    Edit
                  </button>
                  <button
                    className="bg-rose-700 hover:bg-rose-600"
                    onClick={() => remove(trade.id)}
                    disabled={trade.locked}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span>Status: {status}</span>
        {hasMore ? (
          <button onClick={loadMore} className="bg-slate-700 hover:bg-slate-600">
            Load more
          </button>
        ) : (
          <span>No more trades</span>
        )}
      </div>
    </section>
  );
}

export default TradesTable;
