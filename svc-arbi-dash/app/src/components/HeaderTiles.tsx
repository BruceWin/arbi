import { DateTime } from 'luxon';
import { effectiveArbPercentage, withdrawalAmortizationPct } from '../lib/calc';
import { formatDateTime } from '../lib/time';
import { AssetSymbol, Sample } from '../lib/types';
import { LocalSettings } from '../hooks/useLocalSettings';
import { FxQuote } from '../hooks/useFrankfurter';

const ASSETS: AssetSymbol[] = ['ETH', 'BTC', 'USDT'];

function computeDirection(
  asset: AssetSymbol,
  sample: Sample,
  settings: LocalSettings,
  direction: 'KRAKEN_TO_LUNO' | 'LUNO_TO_KRAKEN'
) {
  const snapshot = sample[asset];
  const feeKraken = settings.fees.kraken[asset].taker;
  const feeLuno = settings.fees.luno[asset].taker;
  const slippage = settings.slippageCaps[asset];
  const legs = [
    { feePct: direction === 'KRAKEN_TO_LUNO' ? feeKraken : feeLuno, slippagePct: slippage },
    { feePct: direction === 'KRAKEN_TO_LUNO' ? feeLuno : feeKraken, slippagePct: slippage }
  ];
  const nominal =
    direction === 'KRAKEN_TO_LUNO'
      ? snapshot.arb_buyKraken_sellLuno_pct ?? null
      : snapshot.arb_buyLuno_sellKraken_pct ?? null;
  if (nominal === null) {
    return null;
  }
  let withdrawal = 0;
  if (settings.withdrawalAmortization) {
    const notionalGBP =
      direction === 'KRAKEN_TO_LUNO'
        ? settings.balances.krakenGBP
        : settings.balances.lunoZAR / sample.fx_gbp_zar;
    const perUnit =
      direction === 'KRAKEN_TO_LUNO' ? snapshot.krakenAskGBP ?? 0 : snapshot.krakenBidGBP ?? 0;
    const withdrawalFee =
      settings.withdrawalFees[asset][direction === 'KRAKEN_TO_LUNO' ? 'kraken' : 'luno'];
    if (perUnit && notionalGBP) {
      withdrawal = withdrawalAmortizationPct(withdrawalFee, perUnit, notionalGBP);
    }
  }
  const effective = effectiveArbPercentage({ nominalPct: nominal, legs, withdrawalPct: withdrawal });
  return { nominal, effective, withdrawal, direction };
}

function describeAge(sampleTs: number | null): string {
  if (!sampleTs) {
    return 'No data';
  }
  const diff = DateTime.now().diff(DateTime.fromMillis(sampleTs), 'minutes').minutes;
  if (diff < 1) {
    return 'Updated < 1 min ago';
  }
  return `Updated ${Math.round(diff)} min ago`;
}

type HeaderTilesProps = {
  sample: Sample | null;
  settings: LocalSettings;
  quotes: Record<'GBPZAR' | 'USDZAR', FxQuote | null>;
  onSettingsOpen: () => void;
};

export function HeaderTiles({ sample, settings, quotes, onSettingsOpen }: HeaderTilesProps) {
  const ageLabel = describeAge(sample?.ts ?? null);
  return (
    <section className="grid gap-4 md:grid-cols-4">
      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">FX GBP→ZAR</h2>
          <button onClick={onSettingsOpen} className="bg-slate-700 hover:bg-slate-600 text-xs px-2 py-1">
            Settings
          </button>
        </div>
        <p className="text-3xl font-mono">
          {sample ? sample.fx_gbp_zar.toFixed(3) : '—'}
        </p>
        <p className="text-sm text-slate-400">
          Frankfurter: {quotes.GBPZAR ? quotes.GBPZAR.rate.toFixed(3) : '…'}{' '}
          {quotes.GBPZAR ? `(as of ${formatDateTime(quotes.GBPZAR.fetchedAt)})` : ''}
        </p>
        <p className="text-xs text-slate-500">{ageLabel}</p>
        <p className="text-xs text-slate-500">
          Balances — Luno: R{settings.balances.lunoZAR.toLocaleString()} · Kraken: £{settings.balances.krakenGBP.toLocaleString()}
        </p>
      </div>
      {ASSETS.map((asset) => {
        const kToL = sample ? computeDirection(asset, sample, settings, 'KRAKEN_TO_LUNO') : null;
        const lToK = sample ? computeDirection(asset, sample, settings, 'LUNO_TO_KRAKEN') : null;
        const best = [kToL, lToK].filter(Boolean).sort((a, b) => (b?.effective ?? -Infinity) - (a?.effective ?? -Infinity))[0] ?? null;
        return (
          <div key={asset} className="card p-4 space-y-2">
            <h3 className="text-lg font-semibold">{asset}</h3>
            <div className="flex justify-between text-sm text-slate-400">
              <span>K→L</span>
              <span>{kToL ? `${kToL.effective.toFixed(2)}%` : '—'}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-400">
              <span>L→K</span>
              <span>{lToK ? `${lToK.effective.toFixed(2)}%` : '—'}</span>
            </div>
            <p className="text-xs text-slate-500">
              Nominal best: {best ? `${best.nominal.toFixed(2)}% (${best.direction === 'KRAKEN_TO_LUNO' ? 'K→L' : 'L→K'})` : '—'}
            </p>
          </div>
        );
      })}
    </section>
  );
}

export default HeaderTiles;
