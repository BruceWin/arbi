/* eslint-disable @typescript-eslint/no-explicit-any */
import { DateTime } from 'luxon';
import { computeHmrc } from '../../app/src/lib/hmrc';
import { taxYearBounds, parseUkDate } from '../../app/src/lib/time';
import { Trade, TradeListResponse, TaxYearSummary } from '../../app/src/lib/types';

interface Env {
  AUTH_TOKEN: string;
  TRADE_STORE: DurableObjectNamespace;
  TRADE_LEDGER: DurableObjectNamespace;
}

type EnvWithAssets = Env & {
  ASSETS?: { fetch(request: Request): Promise<Response> };
};

const SECURITY_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function proxyToAsset(request: Request, env: EnvWithAssets, url: URL): Promise<Response> {
  const assets = env.ASSETS;
  if (!assets) {
    return new Response('Assets binding missing', { status: 500 });
  }
  const stripped = url.pathname === '/dash' ? '/index.html' : url.pathname.replace(/^\/dash/, '') || '/index.html';
  const assetUrl = new URL(stripped.startsWith('/') ? stripped : `/${stripped}`, url.origin);
  const assetRequest = new Request(assetUrl.toString(), {
    method: request.method,
    headers: request.headers
  });
  const assetResponse = await assets.fetch(assetRequest);
  return withSecurityHeaders(assetResponse);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const auth = url.searchParams.get('auth');
    if (!auth || auth !== env.AUTH_TOKEN) {
      return new Response('Not found', { status: 404 });
    }
    url.searchParams.delete('auth');

    if (url.pathname === '/dash' || url.pathname.startsWith('/dash/')) {
      return proxyToAsset(request, env as EnvWithAssets, url);
    }

    if (url.pathname === '/data') {
      const id = env.TRADE_STORE.idFromName('arbi-store');
      const stub = env.TRADE_STORE.get(id);
      const proxyUrl = new URL(`https://do${url.pathname}${url.search}`);
      const response = await stub.fetch(new Request(proxyUrl.toString(), request));
      return withSecurityHeaders(response);
    }

    if (url.pathname.startsWith('/trades') || url.pathname.startsWith('/tax/')) {
      const id = env.TRADE_LEDGER.idFromName('ledger');
      const stub = env.TRADE_LEDGER.get(id);
      const target = new URL(`https://ledger${url.pathname}${url.search}`);
      const forwarded = new Request(target.toString(), request);
      const response = await stub.fetch(forwarded);
      return withSecurityHeaders(response);
    }

    return new Response('Not found', { status: 404 });
  }
};

function padTs(ts: number): string {
  return ts.toString().padStart(13, '0');
}

async function responseJson(data: unknown, status = 200): Promise<Response> {
  return withSecurityHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    })
  );
}

async function parseJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function matchesFilters(trade: Trade, filters: { asset?: string; side?: string; from?: number; to?: number }): boolean {
  if (filters.asset && trade.asset !== filters.asset) {
    return false;
  }
  if (filters.side && trade.side !== filters.side) {
    return false;
  }
  if (filters.from && trade.ts < filters.from) {
    return false;
  }
  if (filters.to && trade.ts > filters.to) {
    return false;
  }
  return true;
}

function computeTaxYearLabel(trade: Trade): string {
  const dt = DateTime.fromMillis(trade.ts, { zone: 'Europe/London' });
  const year = dt.month >= 4 ? dt.year : dt.year - 1;
  const suffix = String((year + 1) % 100).padStart(2, '0');
  return `${year}-${suffix}`;
}

async function fetchFxForDate(date: string): Promise<number> {
  const url = `https://api.frankfurter.app/${date}?from=GBP&to=ZAR`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch Frankfurter FX');
  }
  const data = (await res.json()) as { rates: Record<string, number> };
  return data.rates.ZAR;
}

async function convertFeeToGBP(fee: Trade['fee'], perUnitGBP: number, fx: number | undefined, ts: number): Promise<number | undefined> {
  if (!fee) {
    return undefined;
  }
  if (fee.currency === 'GBP') {
    return fee.amount;
  }
  if (fee.currency === 'ASSET') {
    return fee.amount * perUnitGBP;
  }
  if (fee.currency === 'ZAR') {
    if (!fx) {
      const date = DateTime.fromMillis(ts, { zone: 'Europe/London' }).toFormat('yyyy-LL-dd');
      const rate = await fetchFxForDate(date);
      return fee.amount / rate;
    }
    return fee.amount / fx;
  }
  return undefined;
}

async function resolveDerived(trade: Trade): Promise<Trade> {
  if (!trade.priceGBP && (!trade.priceZAR || !trade.fx_gbp_zar)) {
    throw new Error('GBP valuation required');
  }
  let fxSource: 'USER' | 'FRANKFURTER' | 'NONE' = 'NONE';
  let fx = trade.fx_gbp_zar;
  if (!trade.priceGBP && trade.priceZAR && !fx) {
    const date = DateTime.fromMillis(trade.ts, { zone: 'Europe/London' }).toFormat('yyyy-LL-dd');
    fx = await fetchFxForDate(date);
    trade.fx_gbp_zar = fx;
    fxSource = 'FRANKFURTER';
  } else if (trade.fx_gbp_zar) {
    fxSource = 'USER';
  }
  const perUnitGBP = trade.priceGBP ?? (trade.priceZAR! / trade.fx_gbp_zar!);
  const proceeds = perUnitGBP * trade.quantity;
  const feeGBP = await convertFeeToGBP(trade.fee, perUnitGBP, trade.fx_gbp_zar, trade.ts);
  return {
    ...trade,
    derived: {
      perUnitGBP,
      gbpProceedsOrCost: proceeds,
      feeGBP,
      fxSource
    }
  };
}

export class TradeLedger {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/trades/lock') {
      const body = await parseJson<{ ids: string[] }>(request);
      await Promise.all(body.ids.map((id) => this.lockTrade(id)));
      return responseJson({ ok: true });
    }

    if (url.pathname === '/trades' && request.method === 'GET') {
      return this.handleList(url);
    }

    if (url.pathname === '/trades' && request.method === 'POST') {
      const payload = await parseJson<Partial<Trade>>(request);
      return this.handleCreate(payload);
    }

    if (url.pathname.startsWith('/trades/') && request.method === 'GET') {
      const id = url.pathname.split('/')[2];
      const trade = await this.storage.get<Trade>(`trade:${id}`);
      if (!trade) {
        return new Response('Not found', { status: 404 });
      }
      return responseJson(trade);
    }

    if (url.pathname.startsWith('/trades/') && request.method === 'PUT') {
      const id = url.pathname.split('/')[2];
      const payload = await parseJson<Partial<Trade>>(request);
      payload.id = id;
      return this.handleUpdate(payload);
    }

    if (url.pathname.startsWith('/trades/') && request.method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      await this.deleteTrade(id);
      return responseJson({ ok: true });
    }

    if (url.pathname === '/tax/summary' && request.method === 'GET') {
      const taxYear = url.searchParams.get('taxYear');
      if (!taxYear) {
        return new Response('taxYear required', { status: 400 });
      }
      const summary = await this.computeTaxYear(taxYear);
      return responseJson(summary);
    }

    if (url.pathname === '/tax/preview' && request.method === 'GET') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) {
        return new Response('from and to required', { status: 400 });
      }
      const fromTs = parseUkDate(from);
      const toTs = parseUkDate(to) + 24 * 60 * 60 * 1000 - 1;
      const summary = await this.computeWindow(fromTs, toTs);
      return responseJson(summary);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleList(url: URL): Promise<Response> {
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500);
    const cursor = url.searchParams.get('cursor');
    const filters = {
      asset: url.searchParams.get('asset') ?? undefined,
      side: url.searchParams.get('side') ?? undefined,
      from: url.searchParams.get('from') ? Number(url.searchParams.get('from')) : undefined,
      to: url.searchParams.get('to') ? Number(url.searchParams.get('to')) : undefined
    };
    const { trades, nextCursor } = await this.listTrades(filters, limit, cursor ?? undefined);
    const response: TradeListResponse = {
      count: trades.length,
      trades,
      nextCursor: nextCursor ?? null
    };
    return responseJson(response);
  }

  private async handleCreate(payload: Partial<Trade>): Promise<Response> {
    if (!payload.ts || !payload.asset || !payload.side || !payload.quantity) {
      return new Response('Missing fields', { status: 400 });
    }
    const id = `${payload.ts}-${crypto.randomUUID().slice(0, 8)}`;
    const trade: Trade = await resolveDerived({
      ...(payload as Trade),
      id
    });
    await this.putTrade(trade);
    return responseJson(trade, 201);
  }

  private async handleUpdate(payload: Partial<Trade>): Promise<Response> {
    if (!payload.id) {
      return new Response('id required', { status: 400 });
    }
    const existing = await this.storage.get<Trade>(`trade:${payload.id}`);
    if (!existing) {
      return new Response('Not found', { status: 404 });
    }
    if (existing.locked) {
      return new Response('Trade locked', { status: 400 });
    }
    const updated = await resolveDerived({ ...existing, ...payload } as Trade);
    await this.putTrade(updated, existing);
    return responseJson(updated);
  }

  private async lockTrade(id: string): Promise<void> {
    const trade = await this.storage.get<Trade>(`trade:${id}`);
    if (trade) {
      trade.locked = true;
      await this.putTrade(trade, trade);
    }
  }

  private async deleteTrade(id: string): Promise<void> {
    const trade = await this.storage.get<Trade>(`trade:${id}`);
    if (!trade) {
      return;
    }
    if (trade.locked) {
      throw new Error('Trade locked');
    }
    await this.storage.delete(`trade:${id}`);
    await this.storage.delete(`by-asset:${trade.asset}:${padTs(trade.ts)}:${trade.id}`);
    await this.storage.delete(`by-taxyear:${computeTaxYearLabel(trade)}:${padTs(trade.ts)}:${trade.id}`);
  }

  private async putTrade(trade: Trade, previous?: Trade): Promise<void> {
    if (!trade.id) {
      throw new Error('Trade id missing');
    }
    if (previous && previous.id !== trade.id) {
      await this.deleteTrade(previous.id);
    }
    await this.storage.put(`trade:${trade.id}`, trade);
    await this.storage.put(`by-asset:${trade.asset}:${padTs(trade.ts)}:${trade.id}`, true);
    await this.storage.put(`by-taxyear:${computeTaxYearLabel(trade)}:${padTs(trade.ts)}:${trade.id}`, true);
  }

  private async listTrades(
    filters: { asset?: string; side?: string; from?: number; to?: number },
    limit: number,
    cursor?: string
  ): Promise<{ trades: Trade[]; nextCursor?: string }> {
    const result: Trade[] = [];
    let startAfter = cursor ? `trade:${cursor}` : undefined;
    let lastKey: string | undefined;
    const pageSize = limit * 3;
    while (result.length < limit) {
      const page = await this.storage.list<Trade>({ prefix: 'trade:', reverse: true, startAfter, limit: pageSize });
      if (page.size === 0) {
        break;
      }
      for (const [key, trade] of page) {
        lastKey = key;
        startAfter = key;
        if (matchesFilters(trade, filters)) {
          result.push(trade);
          if (result.length === limit) {
            break;
          }
        }
      }
      if (page.size < pageSize) {
        break;
      }
    }
    const nextCursor = result.length === limit && lastKey ? lastKey.replace('trade:', '') : undefined;
    return { trades: result, nextCursor };
  }

  private async loadAllTrades(): Promise<Trade[]> {
    const trades: Trade[] = [];
    let cursor: string | undefined;
    const pageSize = 256;
    while (true) {
      const page = await this.storage.list<Trade>({ prefix: 'trade:', limit: pageSize, startAfter: cursor });
      if (page.size === 0) {
        break;
      }
      for (const [key, value] of page) {
        trades.push(value);
        cursor = key;
      }
      if (page.size < pageSize) {
        break;
      }
    }
    trades.sort((a, b) => a.ts - b.ts);
    return trades;
  }

  private async computeTaxYear(taxYear: string): Promise<TaxYearSummary> {
    const { start, end } = taxYearBounds(taxYear);
    const allTrades = await this.loadAllTrades();
    const windowStart = start.toMillis();
    const windowEnd = end.toMillis();
    const trades = allTrades.filter((trade) => trade.ts <= windowEnd + 30 * 24 * 60 * 60 * 1000);
    const computation = computeHmrc(trades, {
      windowStart,
      windowEnd,
      poolSnapshotAt: windowEnd
    });
    return {
      taxYear,
      totals: computation.totals,
      pools: computation.pools,
      disposals: computation.disposals,
      matchLines: computation.matchLines,
      issues: computation.issues
    };
  }

  private async computeWindow(from: number, to: number): Promise<TaxYearSummary> {
    const allTrades = await this.loadAllTrades();
    const trades = allTrades.filter((trade) => trade.ts >= from - 30 * 24 * 60 * 60 * 1000 && trade.ts <= to + 30 * 24 * 60 * 60 * 1000);
    const computation = computeHmrc(trades, {
      windowStart: from,
      windowEnd: to,
      poolSnapshotAt: to
    });
    return {
      taxYear: `${DateTime.fromMillis(from).toFormat('yyyy')} window`,
      totals: computation.totals,
      pools: computation.pools,
      disposals: computation.disposals,
      matchLines: computation.matchLines,
      issues: computation.issues
    };
  }
}
