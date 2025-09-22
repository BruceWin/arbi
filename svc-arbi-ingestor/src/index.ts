// src/index.ts

interface Env {
  TRADE_STORE: DurableObjectNamespace;
  AUTH_TOKEN: string; // set with: npx wrangler secret put AUTH_TOKEN
}

/** Per-asset snapshot: raw prices + converted + both-direction arbitrage (no fees/slippage). */
type AssetSnapshot = {
  // Luno (ZAR)
  lunoBestBidZAR: number | null;
  lunoBestAskZAR: number | null;

  // Kraken (GBP)
  krakenBidGBP: number | null;
  krakenAskGBP: number | null;

  // Kraken converted to ZAR (using fx_gbp_zar, for convenience/inspection)
  krakenBidZAR: number | null;
  krakenAskZAR: number | null;

  // Spot (one-leg) arbitrage percentages (unitless, for 1 unit of the asset)
  // Buy on Kraken (ask), sell on Luno (bid)
  arb_buyKraken_sellLuno_pct: number | null;
  // Buy on Luno (ask), sell on Kraken (bid)
  arb_buyLuno_sellKraken_pct: number | null;
};

type Cycle = {
  trade: "ETH" | "BTC" | "USDT";
  via: "ETH" | "BTC" | "USDT";
  pct: number | null; // percent gain/loss for 1 starting unit of fiat (ZAR or GBP)
};

type Sample = {
  ts: number;         // ms epoch when computed
  fx_gbp_zar: number; // GBP→ZAR rate used

  // per-asset snapshots
  ETH: AssetSnapshot;
  BTC: AssetSnapshot;
  USDT: AssetSnapshot;

  // full two-leg cycles (no fees/slippage), all trade/via combinations with trade != via
  // Starting on Luno with 1 ZAR -> return to ZAR on Luno
  cycles_from_Luno_ZAR: Cycle[];
  // Starting on Kraken with 1 GBP -> return to GBP on Kraken
  cycles_from_Kraken_GBP: Cycle[];
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
    // 1) FX GBP→ZAR (for convenience fields; cycles themselves don't require FX)
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

    // 4) Build per-asset snapshots (prices + one-leg arb both ways)
    const ETH = composeSnapshot(lETH, kETH, fx);
    const BTC = composeSnapshot(lBTC, kBTC, fx);
    const USDT = composeSnapshot(lUSDT, kUSDT, fx);

    // maps for cycle math
    const lunoBidZAR = { ETH: lETH.bid, BTC: lBTC.bid, USDT: lUSDT.bid } as const;
    const lunoAskZAR = { ETH: lETH.ask, BTC: lBTC.ask, USDT: lUSDT.ask } as const;
    const krakenBidGBP = { ETH: kETH.bidGBP, BTC: kBTC.bidGBP, USDT: kUSDT.bidGBP } as const;
    const krakenAskGBP = { ETH: kETH.askGBP, BTC: kBTC.askGBP, USDT: kUSDT.askGBP } as const;

    // 5) Compute all trade/via cycles (trade != via), both directions
    const assets = ["ETH", "BTC", "USDT"] as const;
    const cycles_from_Luno_ZAR: Cycle[] = [];
    const cycles_from_Kraken_GBP: Cycle[] = [];

    for (const trade of assets) {
      for (const via of assets) {
        if (via === trade) continue; // you asked for "different coin" as the bridge

        // Start with 1 ZAR on Luno; end with ZAR on Luno
        const pctL = cycleFromLunoZAR(
          lunoAskZAR[trade],   // pay this to buy TRADE on Luno
          krakenBidGBP[trade], // sell TRADE on Kraken for GBP
          krakenAskGBP[via],   // buy VIA on Kraken (GBP)
          lunoBidZAR[via]      // sell VIA on Luno for ZAR
        );
        cycles_from_Luno_ZAR.push({ trade, via, pct: pctL });

        // Start with 1 GBP on Kraken; end with GBP on Kraken
        const pctK = cycleFromKrakenGBP(
          krakenAskGBP[trade], // pay this to buy TRADE on Kraken
          lunoBidZAR[trade],   // sell TRADE on Luno for ZAR
          lunoAskZAR[via],     // buy VIA on Luno (ZAR)
          krakenBidGBP[via]    // sell VIA on Kraken for GBP
        );
        cycles_from_Kraken_GBP.push({ trade, via, pct: pctK });
      }
    }

    // 6) Store one sample under its timestamp key
    const sample: Sample = {
      ts: Date.now(),
      fx_gbp_zar: fx,
      ETH, BTC, USDT,
      cycles_from_Luno_ZAR,
      cycles_from_Kraken_GBP
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

/** Parse Luno orderbook_top into numeric best bid/ask (ZAR). */
function parseTop(ob: any): { bid: number | null; ask: number | null } {
  const bid = Number(ob?.bids?.[0]?.price);
  const ask = Number(ob?.asks?.[0]?.price);
  return {
    bid: Number.isFinite(bid) ? bid : null,
    ask: Number.isFinite(ask) ? ask : null
  };
}

/** Fetch Kraken public ticker for a given pair; return bid/ask in GBP (numbers/nulls). */
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

/** Build per-asset snapshot, including conversions and one-leg arbitrage % (no fees/slip). */
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

/**
 * Full cycle starting on Luno with 1 ZAR:
 *   ZAR -> buy TRADE on Luno @ lunoAskZAR
 *   -> sell TRADE on Kraken @ krakenBidGBP -> GBP
 *   -> buy VIA on Kraken @ krakenAskGBP -> VIA units
 *   -> sell VIA on Luno @ lunoBidZAR -> back to ZAR
 * Return % gain/loss relative to 1 ZAR start. (No fees/slippage.)
 */
function cycleFromLunoZAR(
  lunoAskZAR_trade: number | null,
  krakenBidGBP_trade: number | null,
  krakenAskGBP_via: number | null,
  lunoBidZAR_via: number | null
): number | null {
  if (![lunoAskZAR_trade, krakenBidGBP_trade, krakenAskGBP_via, lunoBidZAR_via].every(Number.isFinite)) {
    return null;
  }
  if ((lunoAskZAR_trade as number) <= 0 || (krakenAskGBP_via as number) <= 0) return null;

  const unitsTrade = 1 / (lunoAskZAR_trade as number);                 // asset TRADE units
  const gbp = unitsTrade * (krakenBidGBP_trade as number);              // GBP
  const unitsVia = gbp / (krakenAskGBP_via as number);                  // asset VIA units
  const zarBack = unitsVia * (lunoBidZAR_via as number);                // ZAR
  return 100 * (zarBack - 1); // % vs 1 ZAR start
}

/**
 * Full cycle starting on Kraken with 1 GBP:
 *   GBP -> buy TRADE on Kraken @ krakenAskGBP
 *   -> sell TRADE on Luno @ lunoBidZAR -> ZAR
 *   -> buy VIA on Luno @ lunoAskZAR -> VIA units
 *   -> sell VIA on Kraken @ krakenBidGBP -> back to GBP
 * Return % gain/loss relative to 1 GBP start. (No fees/slippage.)
 */
function cycleFromKrakenGBP(
  krakenAskGBP_trade: number | null,
  lunoBidZAR_trade: number | null,
  lunoAskZAR_via: number | null,
  krakenBidGBP_via: number | null
): number | null {
  if (![krakenAskGBP_trade, lunoBidZAR_trade, lunoAskZAR_via, krakenBidGBP_via].every(Number.isFinite)) {
    return null;
  }
  if ((krakenAskGBP_trade as number) <= 0 || (lunoAskZAR_via as number) <= 0) return null;

  const unitsTrade = 1 / (krakenAskGBP_trade as number);                // asset TRADE units
  const zar = unitsTrade * (lunoBidZAR_trade as number);                // ZAR
  const unitsVia = zar / (lunoAskZAR_via as number);                    // asset VIA units
  const gbpBack = unitsVia * (krakenBidGBP_via as number);              // GBP
  return 100 * (gbpBack - 1); // % vs 1 GBP start
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
