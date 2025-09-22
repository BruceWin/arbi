import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trade, TradeFilters, TradeListResponse } from '../lib/types';

const DEFAULT_LIMIT = 100;

type TradeApiState = {
  trades: Trade[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  hasMore: boolean;
};

type TradeMutationPayload = Omit<Trade, 'id' | 'derived' | 'locked'> & { id?: string };

function buildQuery(filters: TradeFilters, limit: number, cursor: string | null, authToken: string): string {
  const url = new URL('/trades', window.location.origin);
  url.searchParams.set('auth', authToken);
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  if (filters.asset) {
    url.searchParams.set('asset', filters.asset);
  }
  if (filters.side) {
    url.searchParams.set('side', filters.side);
  }
  if (filters.from) {
    url.searchParams.set('from', String(filters.from));
  }
  if (filters.to) {
    url.searchParams.set('to', String(filters.to));
  }
  return url.toString();
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    throw new Error(`Request failed with ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export function useTradesApi(authToken: string) {
  const [state, setState] = useState<TradeApiState>({ trades: [], status: 'idle', error: null, hasMore: false });
  const [filters, setFilters] = useState<TradeFilters>({});
  const [cursor, setCursor] = useState<string | null>(null);

  const load = useCallback(
    async (reset = false) => {
      if (!authToken) {
        return;
      }
      setState((prev) => ({ ...prev, status: 'loading', error: null }));
      try {
        const url = buildQuery(filters, DEFAULT_LIMIT, reset ? null : cursor, authToken);
        const page = await jsonFetch<TradeListResponse>(url);
        setState((prev) => ({
          trades: reset ? page.trades : [...prev.trades, ...page.trades],
          status: 'ready',
          error: null,
          hasMore: Boolean(page.nextCursor)
        }));
        setCursor(page.nextCursor);
      } catch (err) {
        setState((prev) => ({ ...prev, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    },
    [authToken, filters, cursor]
  );

  useEffect(() => {
    void load(true);
  }, [load, filters]);

  const refresh = useCallback(() => load(true), [load]);

  const loadMore = useCallback(() => load(false), [load]);

  const mutate = useCallback(
    async (method: 'POST' | 'PUT', payload: TradeMutationPayload) => {
      const targetUrl = new URL('/trades', window.location.origin);
      targetUrl.searchParams.set('auth', authToken);
      let url = targetUrl.toString();
      if (method === 'PUT' && payload.id) {
        url = new URL(`/trades/${payload.id}`, window.location.origin).toString();
        url += `?auth=${encodeURIComponent(authToken)}`;
      }
      await jsonFetch<Trade>(url, {
        method,
        body: JSON.stringify(payload)
      });
      await refresh();
    },
    [authToken, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const url = new URL(`/trades/${id}`, window.location.origin);
      url.searchParams.set('auth', authToken);
      await jsonFetch<void>(url.toString(), { method: 'DELETE' });
      await refresh();
    },
    [authToken, refresh]
  );

  const lock = useCallback(
    async (ids: string[]) => {
      const url = new URL('/trades/lock', window.location.origin);
      url.searchParams.set('auth', authToken);
      await jsonFetch<void>(url.toString(), { method: 'POST', body: JSON.stringify({ ids }) });
      await refresh();
    },
    [authToken, refresh]
  );

  const read = useCallback(
    async (id: string) => {
      const url = new URL(`/trades/${id}`, window.location.origin);
      url.searchParams.set('auth', authToken);
      return jsonFetch<Trade>(url.toString());
    },
    [authToken]
  );

  return useMemo(
    () => ({
      ...state,
      filters,
      setFilters,
      refresh,
      loadMore,
      create: (payload: TradeMutationPayload) => mutate('POST', payload),
      update: (payload: TradeMutationPayload) => mutate('PUT', payload),
      remove,
      lock,
      read
    }),
    [state, filters, refresh, loadMore, mutate, remove, lock, read]
  );
}
