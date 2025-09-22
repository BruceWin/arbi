import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Page, Sample } from '../lib/types';

const PAGE_LIMIT = 250;

type Status = 'idle' | 'loading' | 'ready' | 'error';

type UseDataWindowOptions = {
  authToken: string;
  historyHours: number;
  autoRefreshMs: number;
};

async function fetchSamples(authToken: string, cursor: string | null, limit: number): Promise<Page> {
  const url = new URL('/data', window.location.origin);
  url.searchParams.set('auth', authToken);
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('cursor', cursor);
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Cache-Control': 'no-store'
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch samples (${res.status})`);
  }
  return (await res.json()) as Page;
}

function mergeSamples(existing: Sample[], incoming: Sample[]): Sample[] {
  const map = new Map<number, Sample>();
  for (const sample of existing) {
    map.set(sample.ts, sample);
  }
  for (const sample of incoming) {
    map.set(sample.ts, sample);
  }
  return Array.from(map.values()).sort((a, b) => a.ts - b.ts);
}

export function useDataWindow({ authToken, historyHours, autoRefreshMs }: UseDataWindowOptions) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const refreshTimer = useRef<number | null>(null);
  const loadingMore = useRef(false);

  const loadInitial = useCallback(async () => {
    if (!authToken) {
      return;
    }
    setStatus('loading');
    setError(null);
    const cutoff = Date.now() - historyHours * 60 * 60 * 1000;
    let cursor: string | null = null;
    let accumulated: Sample[] = [];
    try {
      while (true) {
        const page = await fetchSamples(authToken, cursor, PAGE_LIMIT);
        accumulated = mergeSamples(accumulated, page.samples);
        cursor = page.nextCursor;
        if (!cursor) {
          setNextCursor(null);
          break;
        }
        const oldest = accumulated[0]?.ts ?? Infinity;
        if (oldest <= cutoff) {
          setNextCursor(cursor);
          break;
        }
      }
      setSamples(accumulated);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [authToken, historyHours]);

  const refresh = useCallback(async () => {
    if (!authToken) {
      return;
    }
    try {
      const page = await fetchSamples(authToken, null, Math.max(50, PAGE_LIMIT / 2));
      setSamples((prev) => mergeSamples(prev, page.samples));
      setNextCursor((prevCursor) => prevCursor ?? page.nextCursor ?? null);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [authToken]);

  const loadMore = useCallback(async () => {
    if (!authToken || !nextCursor || loadingMore.current) {
      return;
    }
    loadingMore.current = true;
    try {
      const page = await fetchSamples(authToken, nextCursor, PAGE_LIMIT);
      setSamples((prev) => mergeSamples(prev, page.samples));
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      loadingMore.current = false;
    }
  }, [authToken, nextCursor]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (refreshTimer.current) {
      window.clearInterval(refreshTimer.current);
    }
    refreshTimer.current = window.setInterval(() => {
      void refresh();
    }, autoRefreshMs);
    return () => {
      if (refreshTimer.current) {
        window.clearInterval(refreshTimer.current);
      }
    };
  }, [autoRefreshMs, refresh]);

  const state = useMemo(
    () => ({ samples, status, error, refresh, loadMore, hasMore: Boolean(nextCursor) }),
    [samples, status, error, refresh, loadMore, nextCursor]
  );

  return state;
}
