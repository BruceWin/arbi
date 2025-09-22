import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FrankfurterQuote } from '../lib/fx';

const CACHE_MS = 60_000;

export type QuoteKey = 'GBPZAR' | 'USDZAR';

export type FxQuote = {
  pair: QuoteKey;
  rate: number;
  fetchedAt: number;
};

async function fetchQuote(base: string, symbol: string): Promise<FxQuote> {
  const res = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${symbol}`);
  if (!res.ok) {
    throw new Error(`Frankfurter request failed: ${res.status}`);
  }
  const payload = (await res.json()) as FrankfurterQuote;
  const rate = payload.rates[symbol];
  return {
    pair: `${base}${symbol}` as QuoteKey,
    rate,
    fetchedAt: Date.now()
  };
}

export function useFrankfurter() {
  const [quotes, setQuotes] = useState<Record<QuoteKey, FxQuote | null>>({ GBPZAR: null, USDZAR: null });
  const quotesRef = useRef(quotes);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);

  const load = useCallback(async () => {
    if (pending.current) {
      return pending.current;
    }
    const task = (async () => {
      try {
        const [gbp, usd] = await Promise.all([fetchQuote('GBP', 'ZAR'), fetchQuote('USD', 'ZAR')]);
        const next = { GBPZAR: gbp, USDZAR: usd } as Record<QuoteKey, FxQuote>;
        quotesRef.current = next;
        setQuotes(next);
        setError(null);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        pending.current = null;
      }
    })();
    pending.current = task;
    await task;
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      const now = Date.now();
      const stale = Object.values(quotesRef.current).some((quote) => !quote || now - quote.fetchedAt > CACHE_MS);
      if (stale) {
        void load();
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);

  const latest = useMemo(() => quotes, [quotes]);

  return { quotes: latest, error, refresh };
}
