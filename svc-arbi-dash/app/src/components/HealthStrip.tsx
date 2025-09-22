import { useMemo, useState } from 'react';
import { minutesBetween } from '../lib/time';
import { Sample } from '../lib/types';

type HealthStripProps = {
  samples: Sample[];
  frankfurterError: string | null;
  dataError: string | null;
  tradeError: string | null;
};

function hasNullLegs(samples: Sample[]): boolean {
  return samples.slice(-3).some((sample) => {
    return ['ETH', 'BTC', 'USDT'].some((asset) => {
      const snapshot = sample[asset as 'ETH'];
      return (
        snapshot.lunoBestBidZAR === null ||
        snapshot.lunoBestAskZAR === null ||
        snapshot.krakenBidGBP === null ||
        snapshot.krakenAskGBP === null
      );
    });
  });
}

function Badge({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'error' }) {
  const base = 'px-2 py-1 rounded text-xs font-semibold uppercase tracking-wide';
  if (tone === 'ok') {
    return <span className={`${base} bg-emerald-900 text-emerald-300`}>{label}</span>;
  }
  if (tone === 'warn') {
    return <span className={`${base} bg-amber-900 text-amber-300`}>{label}</span>;
  }
  return <span className={`${base} bg-rose-900 text-rose-200`}>{label}</span>;
}

export function HealthStrip({ samples, frankfurterError, dataError, tradeError }: HealthStripProps) {
  const [open, setOpen] = useState(false);

  const flags = useMemo(() => {
    const now = Date.now();
    const latestTs = samples.length ? samples[samples.length - 1].ts : null;
    const stale = latestTs ? minutesBetween(latestTs, now) > 2 : true;
    const nullLeg = hasNullLegs(samples);
    const items = [] as Array<{ label: string; tone: 'ok' | 'warn' | 'error'; detail?: string }>;
    items.push({ label: stale ? 'Stale data' : 'Fresh data', tone: stale ? 'warn' : 'ok' });
    items.push({ label: nullLeg ? 'Null legs detected' : 'Legs healthy', tone: nullLeg ? 'warn' : 'ok' });
    if (frankfurterError) {
      items.push({ label: 'FX issue', tone: 'error', detail: frankfurterError });
    }
    if (dataError) {
      items.push({ label: 'Data API error', tone: 'error', detail: dataError });
    }
    if (tradeError) {
      items.push({ label: 'Trades API error', tone: 'error', detail: tradeError });
    }
    if (items.length === 2 && !stale && !nullLeg) {
      items.push({ label: 'Systems nominal', tone: 'ok' });
    }
    return items;
  }, [samples, frankfurterError, dataError, tradeError]);

  return (
    <section className="card p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {flags.map((flag) => (
          <Badge key={flag.label} label={flag.label} tone={flag.tone} />
        ))}
        <button onClick={() => setOpen((prev) => !prev)} className="ml-auto bg-slate-700 hover:bg-slate-600 text-xs">
          Diagnostics
        </button>
      </div>
      {open ? (
        <div className="text-xs text-slate-300 space-y-1">
          {flags
            .filter((flag) => flag.detail)
            .map((flag) => (
              <div key={flag.label}>{flag.label}: {flag.detail}</div>
            ))}
          {!flags.some((flag) => flag.detail) && <p>No recent errors.</p>}
        </div>
      ) : null}
    </section>
  );
}

export default HealthStrip;
