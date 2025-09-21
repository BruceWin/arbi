// src/index.ts

interface Env {
  TRADE_STORE: DurableObjectNamespace;
  AUTH_TOKEN: string; // <-- secret
}

/** Per-asset snapshot: raw prices + converted + both-direction arbitrage (no fees/slippage). */
type AssetSnapshot = {
  // Luno (ZAR)
  lunoBestBidZAR: number | null;
  lunoBestAskZAR: number | null;

  // Kraken (GBP)
  krakenBidGBP: number | null;
  krakenAskGBP: number | null;

  // Kraken converted to ZAR
  krakenBidZAR: number | null;
  krakenAskZAR: number | null;

  // Arbitrage percentages (unitless, for 1 unit of the asset)
  arb_buyKraken_sellLuno_pct: number | null;   // buy Kraken (ask), sell Luno (bid)
  arb_buyLuno_sellKraken_pct: number | null;   // buy Luno (ask), sell Kraken (bid)
};

type Sample = {
  ts: number;         // ms epoch when computed
  fx_gbp_zar: number; // GBP→ZAR rate used
  ETH: AssetSnapshot;
  BTC: AssetSnapshot;
  USDT: AssetSnapshot;
};

export default {
  // Read endpoint (requires ?auth=<token> or returns 404)
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const auth = url.searchParams.get("auth");
    if (!env.AUTH_TOKEN || auth !== env.AUTH_TOKEN) {
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/data") {
      const id = env.TRADE_STORE.idFromName("arbi-store");
      const stub = env.TRADE_STORE.get(id);
      return stub.fetch(new Request("https://do/data" + url.search));
    }

    return new Response("Not found", { status: 404 });
  },

  // Cron: once per minute
  async scheduled(_event: ScheduledController, env: Env) {
    // 1) FX GBP→ZAR
    const fx = await fetch("https://api.frankfurter.app/latest?from=GBP&to=ZAR")
      .then(r => r.json()).then(d => Number(d.rates.ZAR));

    // 2) Luno top-of-book (ZAR) for ETH, BTC (XBT), USDT
    const [obETH, obBTC, obUSDT] = await Promise.all([
      fetch("https://api.luno.com/api/1/orderbook_top?pair=ETHZAR").then(r => r.json()),
      fetch("https://api.luno.com/api/1/orderbook_top?pair=XBTZAR").then(r => r.json()),
      fetch("https://api.luno.com/api/1/orderbook_top?pair=USDTZAR").then(r => r.json()),
    ]);
    const lETH = parseTop(obETH);
    const lBTC = parseTop(obBTC);
    const lUSDT = parseTop(obUSDT);

    // 3) Kraken tickers (GBP) for ETH, BTC (XBT), USDT
    const [kETH, kBTC, kUSDT] = await Promise.all([
      krakenTicker("ETHGBP"),
      krakenTicker("XBTGBP"),
      krakenTicker("USDTGBP"),
    ]);

    // 4) Build snapshots (prices + arb both ways)
    const ETH = composeSnapshot(lETH, kETH, fx);
    const BTC = composeSnapshot(lBTC, kBTC, fx);
    const USDT = composeSnapshot(lUSDT, kUSDT, fx);

    // 5) Store one sample under its timestamp key
    const sample: Sample = {
      ts: Date.now(),
      fx_gbp_zar: fx,
      ETH, BTC, USDT
    };

    console.log("sample", sample);

    const id = env.TRADE_STORE.idFromName("arbi-store");
    const stub = env.TRADE_STORE.get(id);
    await stub.fetch("https://do/append", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample)
    });
  }
} satisfies ExportedHandler<Env>;

// ---------------- Helpers ----------------

function parseTop(ob: any): { bid: number | null; ask: number | null } {
  const bid = Number(ob?.bids?.[0]?.price);
  const ask = Number(ob?.asks?.[0]?.price);
  return {
    bid: Number.isFinite(bid) ? bid : null,
    ask: Number.isFinite(ask) ? ask : null
  };
}

async function krakenTicker(pair: string): Promise<{ bidGBP: number | null; askGBP: number | null }> {
  const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  if (!res.ok) throw new Error(`Kraken ${pair} HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  const key = Object.keys(data.result ?? {})[0];
  const bid = Number(data.result?.[key]?.b?.[0]);
  const ask = Number(data.result?.[key]?.a?.[0]);
  return {
    bidGBP: Number.isFinite(bid) ? bid : null,
    askGBP: Number.isFinite(ask) ? ask : null
  };
}

function composeSnapshot(
  lunoTop: { bid: number | null; ask: number | null },
  krakenTop: { bidGBP: number | null; askGBP: number | null },
  fx: number
): AssetSnapshot {
  const lunoBestBidZAR = lunoTop.bid ?? null;
  const lunoBestAskZAR = lunoTop.ask ?? null;

  const krakenBidGBP = krakenTop.bidGBP ?? null;
  const krakenAskGBP = krakenTop.askGBP ?? null;

  const krakenBidZAR = Number.isFinite(krakenBidGBP) ? (krakenBidGBP as number) * fx : null;
  const krakenAskZAR = Number.isFinite(krakenAskGBP) ? (krakenAskGBP as number) * fx : null;

  const arb_buyKraken_sellLuno_pct =
    Number.isFinite(krakenAskZAR) && Number.isFinite(lunoBestBidZAR) && (krakenAskZAR as number) > 0
      ? 100 * ((lunoBestBidZAR as number) - (krakenAskZAR as number)) / (krakenAskZAR as number)
      : null;

  const arb_buyLuno_sellKraken_pct =
    Number.isFinite(lunoBestAskZAR) && Number.isFinite(krakenBidZAR) && (lunoBestAskZAR as number) > 0
      ? 100 * ((krakenBidZAR as number) - (lunoBestAskZAR as number)) / (lunoBestAskZAR as number)
      : null;

  return {
    lunoBestBidZAR,
    lunoBestAskZAR,
    krakenBidGBP,
    krakenAskGBP,
    krakenBidZAR,
    krakenAskZAR,
    arb_buyKraken_sellLuno_pct,
    arb_buyLuno_sellKraken_pct
  };
}

// ---------------- Durable Object (per-sample key = timestamp) ----------------

export class TradeStore {
  private state: DurableObjectState;
  private env: Env;
  private cap = 50000; // Keep the newest 50k samples

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.endsWith("/append") && req.method === "POST") {
      const sample = (await req.json()) as Sample;

      const key = String(sample.ts); // key is the timestamp
      await this.state.storage.put(key, sample);

      // Enforce cap: list newest-first and delete older overflow
      const keep = this.cap;
      const list = await this.state.storage.list<Sample>({ reverse: true, limit: keep + 100 });
      const entries = [...list];
      if (entries.length > keep) {
        const extras = entries.slice(keep).map(([k]) => k);
        for (const k of extras) await this.state.storage.delete(k);
      }

      return new Response("ok");
    }

    if (url.pathname.endsWith("/data")) {
      const limitParam  = url.searchParams.get("limit");
      const cursorParam = url.searchParams.get("cursor"); // optional: startAfter key
      const limit = (() => {
        const n = Math.floor(Number(limitParam));
        if (!Number.isFinite(n)) return 200;
        return Math.max(1, Math.min(2000, n));
      })();

      const list = await this.state.storage.list<Sample>({
        reverse: true,
        limit,
        startAfter: cursorParam || undefined
      });

      const entries = [...list];
      const samples = entries.map(([, v]) => v);
      const nextCursor = entries.length ? entries[entries.length - 1][0] : null;

      return new Response(JSON.stringify({ count: samples.length, nextCursor, samples }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    return new Response("ready");
  }
}
