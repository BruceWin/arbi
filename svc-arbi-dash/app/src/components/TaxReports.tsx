import { FormEvent, useMemo, useState } from 'react';
import { TaxYearSummary } from '../lib/types';
import ExportCsvButton from './ExportCsvButton';

interface TaxReportsProps {
  authToken: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
  if (!res.ok) {
    throw new Error(`Request failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

export function TaxReports({ authToken }: TaxReportsProps) {
  const now = new Date();
  const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const defaultTaxYear = `${currentYear}-${String((currentYear + 1) % 100).padStart(2, '0')}`;
  const [taxYear, setTaxYear] = useState(defaultTaxYear);
  const [summary, setSummary] = useState<TaxYearSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('loading');
    setError(null);
    try {
      const url = new URL('/tax/summary', window.location.origin);
      url.searchParams.set('auth', authToken);
      url.searchParams.set('taxYear', taxYear);
      const result = await fetchJson<TaxYearSummary>(url.toString());
      setSummary(result);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to compute tax summary');
    }
  };

  const matchCsv = useMemo(() => {
    if (!summary) {
      return [] as Array<Record<string, unknown>>;
    }
    return summary.matchLines.map((line) => ({
      sellRef: line.sellRef,
      asset: line.asset,
      ts: line.ts,
      rule: line.rule,
      buyRef: line.buyRef ?? '',
      qty: line.matchedQty,
      proceeds: line.proceedsGBP,
      allowable_cost: line.allowableCostGBP,
      gain: line.gainGBP
    }));
  }, [summary]);

  const disposalCsv = useMemo(() => {
    if (!summary) {
      return [] as Array<Record<string, unknown>>;
    }
    return summary.disposals.map((disposal) => ({
      sellRef: disposal.sellRef,
      ts: disposal.ts,
      asset: disposal.asset,
      quantity: disposal.quantity,
      grossProceeds: disposal.grossProceedsGBP,
      fees: disposal.disposalFeesGBP,
      netProceeds: disposal.netProceedsGBP,
      totalGain: disposal.totalGainGBP
    }));
  }, [summary]);

  const totals = summary?.totals ?? { overallGainGBP: 0, byAsset: { ETH: 0, BTC: 0, USDT: 0 } };
  const pools = summary?.pools ?? { ETH: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 }, BTC: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 }, USDT: { totalQty: 0, totalCostGBP: 0, avgCostGBP: 0 } };

  return (
    <section className="card p-4 space-y-4">
      <form onSubmit={loadSummary} className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          Tax year (YYYY-YY)
          <input value={taxYear} onChange={(event) => setTaxYear(event.target.value)} />
        </label>
        <button type="submit" className="bg-slate-700 hover:bg-slate-600">
          Compute HMRC gains
        </button>
        {summary ? (
          <>
            <ExportCsvButton filename="tax-disposals.csv" rows={disposalCsv} />
            <ExportCsvButton filename="tax-match-lines.csv" rows={matchCsv} />
          </>
        ) : null}
      </form>
      {status === 'loading' ? <p className="text-xs text-slate-400">Calculating…</p> : null}
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      {summary ? (
        <div className="space-y-4 text-sm">
          <section className="grid gap-3 md:grid-cols-3">
            <div className="card p-3">
              <h4 className="text-xs uppercase text-slate-400">Overall gain (GBP)</h4>
              <p className="text-2xl font-mono">£{totals.overallGainGBP.toFixed(2)}</p>
            </div>
            {Object.entries(totals.byAsset).map(([asset, value]) => (
              <div key={asset} className="card p-3">
                <h4 className="text-xs uppercase text-slate-400">{asset} gain</h4>
                <p className="text-2xl font-mono">£{value.toFixed(2)}</p>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h4 className="font-semibold">Section 104 closing pools</h4>
            <div className="grid gap-3 md:grid-cols-3 text-xs">
              {Object.entries(pools).map(([asset, pool]) => (
                <div key={asset} className="card p-3 space-y-1">
                  <div className="text-sm font-semibold">{asset}</div>
                  <div>Quantity: {pool.totalQty.toFixed(6)}</div>
                  <div>Total cost: £{pool.totalCostGBP.toFixed(2)}</div>
                  <div>Avg cost: £{pool.avgCostGBP.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h4 className="font-semibold">Disposals</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-900 text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Asset</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Gross</th>
                    <th className="px-3 py-2 text-right">Fees</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.disposals.map((disposal) => (
                    <tr key={disposal.sellRef} className="odd:bg-slate-900/40">
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(disposal.ts).toLocaleString('en-GB', { hour12: false })}</td>
                      <td className="px-3 py-2">{disposal.asset}</td>
                      <td className="px-3 py-2 text-right font-mono">{disposal.quantity.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right font-mono">£{disposal.grossProceedsGBP.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">£{disposal.disposalFeesGBP.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">£{disposal.netProceedsGBP.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">£{disposal.totalGainGBP.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="space-y-2 text-xs">
            <h4 className="font-semibold">Match lines</h4>
            <div className="overflow-x-auto max-h-64">
              <table className="min-w-full">
                <thead className="bg-slate-900 text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Sell Ref</th>
                    <th className="px-3 py-2">Rule</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Proceeds</th>
                    <th className="px-3 py-2">Allowable cost</th>
                    <th className="px-3 py-2">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.matchLines.map((line) => (
                    <tr key={`${line.sellRef}-${line.rule}-${line.buyRef ?? 'pool'}-${line.matchedQty}`} className="odd:bg-slate-900/40">
                      <td className="px-3 py-2">{line.sellRef}</td>
                      <td className="px-3 py-2">{line.rule}</td>
                      <td className="px-3 py-2 text-right font-mono">{line.matchedQty.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right font-mono">£{line.proceedsGBP.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono">£{line.allowableCostGBP.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">£{line.gainGBP.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Compute a tax year to view results. Not tax advice.</p>
      )}
    </section>
  );
}

export default TaxReports;
