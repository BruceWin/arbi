# AGENTS.md — svc-arbi-ingestor

> This file is service-local guidance. The **root-level `AGENTS.md`** remains authoritative for repository-wide rules. Do **not** change public contracts without updating the root brief and `svc-arbi-dash` accordingly.

## Role
You are the **data ingestor** for the arbitrage system. Your job: fetch prices and FX once per minute, compute snapshots and cycles, and persist them to a Durable Object so other services (e.g., `svc-arbi-dash`) can read the same dataset.

## Boundaries & Contracts
- **Producer-only**: write samples to the `TradeStore` Durable Object and expose a read-through **`/data`** for consumers.
- **Public API surface (MUST remain stable)**:
  - `GET /data?auth=<token>&limit=<1..2000>&cursor=<key>` → JSON page:
    ```ts
    type AssetSnapshot = {
      lunoBestBidZAR: number|null;
      lunoBestAskZAR: number|null;
      krakenBidGBP:   number|null;
      krakenAskGBP:   number|null;
      krakenBidZAR:   number|null;
      krakenAskZAR:   number|null;
      arb_buyKraken_sellLuno_pct: number|null;
      arb_buyLuno_sellKraken_pct: number|null;
    };

    type Cycle = {
      trade: 'ETH'|'BTC'|'USDT';
      via:   'ETH'|'BTC'|'USDT';
      pct:   number|null; // % gain/loss for one-unit start fiat
    };

    type Sample = {
      ts: number;           // ms epoch (UTC)
      fx_gbp_zar: number;   // GBP→ZAR rate used for conversions
      ETH: AssetSnapshot;
      BTC: AssetSnapshot;
      USDT: AssetSnapshot;
      cycles_from_Luno_ZAR: Cycle[];
      cycles_from_Kraken_GBP: Cycle[];
    };

    type Page = {
      count: number;           // number of samples in this page
      nextCursor: string|null; // key to startAfter for older data
      samples: Sample[];       // newest-f
