# AGENTS.md

> Single-agent, single-version execution. Do **not** ask for more guidance files.

## Role
You are a senior full-stack engineer generating a production-ready Cloudflare Worker + React (Vite + Tailwind) project.

## Objective
Create a new service **`svc-arbi-dash`** (dashboard + trade history, **no alerts**) as a sibling to the existing **`svc-arbi-ingestor`**.

## Where to put things
- Create a new folder at the repo root: **`/svc-arbi-dash`**
- Inside it, create:
  - `/app` — Vite React app (TypeScript + Tailwind)
  - `/worker/src/index.ts` — Cloudflare Worker
  - `/wrangler.json` — Worker config
  - `/package.json` (root for this service) with scripts
  - `/tsconfig.json` (root)
  - `/.eslintrc.cjs`
  - `/tests` — vitest unit tests
  - `/README.md`
- Do **not** modify `/svc-arbi-ingestor` except to reference its Durable Object via `script_name`.

## Security
All HTTP routes in `svc-arbi-dash` require `?auth=<token>` and return **404** if missing/invalid. Never hardcode secrets. Use Wrangler secret `AUTH_TOKEN`.

## Durable Objects
- **Shared market data DO** (owned by `svc-arbi-ingestor`):
  - Binding: `TRADE_STORE`
  - `class_name`: `TradeStore`
  - `script_name`: `svc-arbi-ingestor`
  - Instance id: `idFromName("arbi-store")`
  - **No migrations** here.
- **Local trade ledger DO** (owned by `svc-arbi-dash`):
  - Binding: `TRADE_LEDGER`
  - `class_name`: `TradeLedger`
  - Instance id: `idFromName("ledger")`
  - **Add migrations** here.

## Routes to implement (in `svc-arbi-dash`)
_All require `?auth`._
- `GET /dash` → serve React SPA
- `GET /data` → proxy to `TRADE_STORE`_
