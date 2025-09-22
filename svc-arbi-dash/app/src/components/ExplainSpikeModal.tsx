import { effectiveArbPercentage, slippageDeduction, withdrawalAmortizationPct } from '../lib/calc';
import { Sample, AssetSymbol } from '../lib/types';
import { LocalSettings } from '../hooks/useLocalSettings';

interface ExplainSpikeModalProps {
  open: boolean;
  asset: AssetSymbol | null;
  sample: Sample | null;
  settings: LocalSettings;
  onClose: () => void;
}

export function ExplainSpikeModal({ open, asset, sample, settings, onClose }: ExplainSpikeModalProps) {
  if (!open || !asset || !sample) {
    return null;
  }
  const snapshot = sample[asset];
  const nominalK = snapshot.arb_buyKraken_sellLuno_pct ?? 0;
  const nominalL = snapshot.arb_buyLuno_sellKraken_pct ?? 0;
  const legs = [
    { feePct: settings.fees.kraken[asset].taker, slippagePct: settings.slippageCaps[asset] },
    { feePct: settings.fees.luno[asset].taker, slippagePct: settings.slippageCaps[asset] }
  ];
  const withdrawalK = snapshot.krakenAskGBP
    ? withdrawalAmortizationPct(settings.withdrawalFees[asset].kraken, snapshot.krakenAskGBP, settings.balances.krakenGBP)
    : 0;
  const withdrawalL = snapshot.krakenBidGBP
    ? withdrawalAmortizationPct(
        settings.withdrawalFees[asset].luno,
        snapshot.krakenBidGBP,
        settings.balances.lunoZAR / sample.fx_gbp_zar
      )
    : 0;
  const effectiveK = effectiveArbPercentage({ nominalPct: nominalK, legs, withdrawalPct: withdrawalK });
  const reverseLegs = [...legs].reverse();
  const effectiveL = effectiveArbPercentage({ nominalPct: nominalL, legs: reverseLegs, withdrawalPct: withdrawalL });
  const legFeeCost = legs.reduce((acc, leg) => acc + (leg.feePct ?? 0), 0);
  const slippage = slippageDeduction(legs);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="card max-w-xl w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Explain spike — {asset}</h3>
          <button onClick={onClose} className="bg-slate-700 hover:bg-slate-600 text-xs">
            Close
          </button>
        </div>
        <p className="text-xs text-slate-300">Timestamp: {new Date(sample.ts).toLocaleString('en-GB', { hour12: false })}</p>
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          <div className="space-y-1">
            <h4 className="font-semibold">Kraken → Luno</h4>
            <div>Nominal: {nominalK.toFixed(3)}%</div>
            <div>Effective: {effectiveK.toFixed(3)}%</div>
            <div>Fees: {legFeeCost.toFixed(3)}%</div>
            <div>Slippage cap: {slippage.toFixed(3)}%</div>
            <div>Withdrawal amortization: {withdrawalK.toFixed(3)}%</div>
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold">Luno → Kraken</h4>
            <div>Nominal: {nominalL.toFixed(3)}%</div>
            <div>Effective: {effectiveL.toFixed(3)}%</div>
            <div>Fees: {legFeeCost.toFixed(3)}%</div>
            <div>Slippage cap: {slippage.toFixed(3)}%</div>
            <div>Withdrawal amortization: {withdrawalL.toFixed(3)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExplainSpikeModal;
