import { FormEvent, useEffect, useState } from 'react';
import { useFrankfurter } from '../hooks/useFrankfurter';
import { parseUkDateTime, toLondonDateTime } from '../lib/time';
import { Trade, TradeSide, AssetSymbol, Money } from '../lib/types';

interface TradesFormProps {
  onSubmit: (payload: Partial<Trade> & { id?: string }) => Promise<void>;
  editing?: Trade | null;
  onCancelEdit?: () => void;
}

const ASSETS: AssetSymbol[] = ['ETH', 'BTC', 'USDT'];
const SIDES: TradeSide[] = ['BUY', 'SELL'];

const currencyOptions: Money['currency'][] = ['GBP', 'ZAR', 'ASSET'];

export function TradesForm({ onSubmit, editing, onCancelEdit }: TradesFormProps) {
  const { quotes } = useFrankfurter();
  const [tsLocal, setTsLocal] = useState(() => new Date().toISOString().slice(0, 16));
  const [asset, setAsset] = useState<AssetSymbol>('ETH');
  const [side, setSide] = useState<TradeSide>('BUY');
  const [quantity, setQuantity] = useState(0);
  const [priceGBP, setPriceGBP] = useState<number | ''>('');
  const [priceZAR, setPriceZAR] = useState<number | ''>('');
  const [fx, setFx] = useState<number | ''>('');
  const [venue, setVenue] = useState<'LUNO' | 'KRAKEN' | 'OTHER'>('LUNO');
  const [feeAmount, setFeeAmount] = useState<number | ''>('');
  const [feeCurrency, setFeeCurrency] = useState<Money['currency']>('GBP');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      const dt = toLondonDateTime(editing.ts);
      setTsLocal(dt.toFormat("yyyy-LL-dd'T'HH:mm"));
      setAsset(editing.asset);
      setSide(editing.side);
      setQuantity(editing.quantity);
      setPriceGBP(editing.priceGBP ?? '');
      setPriceZAR(editing.priceZAR ?? '');
      setFx(editing.fx_gbp_zar ?? '');
      setVenue(editing.venue ?? 'LUNO');
      setFeeAmount(editing.fee?.amount ?? '');
      setFeeCurrency(editing.fee?.currency ?? 'GBP');
      setNotes(editing.notes ?? '');
    }
  }, [editing]);

  useEffect(() => {
    if (!priceGBP && priceZAR && !fx && quotes.GBPZAR) {
      setFx(quotes.GBPZAR.rate);
    }
  }, [priceGBP, priceZAR, fx, quotes]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (!priceGBP && !(priceZAR && fx)) {
        throw new Error('Provide GBP price or ZAR price with FX');
      }
      const ts = parseUkDateTime(tsLocal.replace('T', ' '));
      const payload: Partial<Trade> & { id?: string } = {
        id: editing?.id,
        ts,
        asset,
        side,
        quantity,
        venue,
        priceGBP: priceGBP === '' ? undefined : Number(priceGBP),
        priceZAR: priceZAR === '' ? undefined : Number(priceZAR),
        fx_gbp_zar: fx === '' ? undefined : Number(fx),
        notes: notes || undefined
      };
      if (feeAmount !== '') {
        payload.fee = { amount: Number(feeAmount), currency: feeCurrency };
      }
      await onSubmit(payload);
      if (!editing) {
        setQuantity(0);
        setPriceGBP('');
        setPriceZAR('');
        setFx('');
        setFeeAmount('');
        setNotes('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit trade');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{editing ? 'Edit trade' : 'New trade'}</h3>
        {editing && onCancelEdit ? (
          <button type="button" onClick={onCancelEdit} className="bg-slate-700 hover:bg-slate-600 text-xs">
            Cancel edit
          </button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          Timestamp (UK)
          <input type="datetime-local" value={tsLocal} onChange={(event) => setTsLocal(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          Asset
          <select value={asset} onChange={(event) => setAsset(event.target.value as AssetSymbol)}>
            {ASSETS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Side
          <select value={side} onChange={(event) => setSide(event.target.value as TradeSide)}>
            {SIDES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Quantity
          <input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Price GBP (optional)
          <input type="number" value={priceGBP} onChange={(event) => setPriceGBP(event.target.value === '' ? '' : Number(event.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Price ZAR (optional)
          <input type="number" value={priceZAR} onChange={(event) => setPriceZAR(event.target.value === '' ? '' : Number(event.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          FX GBP→ZAR
          <input type="number" value={fx} onChange={(event) => setFx(event.target.value === '' ? '' : Number(event.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Venue
          <select value={venue} onChange={(event) => setVenue(event.target.value as typeof venue)}>
            <option value="LUNO">Luno</option>
            <option value="KRAKEN">Kraken</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Fee amount
          <input type="number" value={feeAmount} onChange={(event) => setFeeAmount(event.target.value === '' ? '' : Number(event.target.value))} />
        </label>
        <label className="flex flex-col gap-1">
          Fee currency
          <select value={feeCurrency} onChange={(event) => setFeeCurrency(event.target.value as Money['currency'])}>
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="bg-sky-600 hover:bg-sky-500 text-sm">
          {editing ? 'Save trade' : 'Create trade'}
        </button>
      </div>
    </form>
  );
}

export default TradesForm;
