# svc-arbi-dash

svc-arbi-dash is a Cloudflare Worker + React (Vite + Tailwind) dashboard for monitoring cross-exchange arbitrage between Luno and Kraken, capturing user trades, and generating UK HMRC capital gains reports. The service shares market samples from the `svc-arbi-ingestor` Durable Object and adds its own `TradeLedger` Durable Object for trade history and tax computation.

```
repo
└── svc-arbi-dash
    ├── app/                # React SPA (Vite + Tailwind)
    ├── worker/             # Cloudflare Worker + TradeLedger DO
    ├── tests/              # Vitest unit tests (calc + HMRC)
    ├── wrangler.json       # Worker configuration
    ├── package.json        # root scripts & dependencies
    └── README.md           # this file
```

## Architecture

* **Cloudflare Worker (`worker/src/index.ts`)** – handles all routing, enforces `?auth=<token>` security, proxies `/data` to the shared `TradeStore` DO, forwards `/trades*` and `/tax/*` to the local `TradeLedger`, and serves the SPA at `/dash`.
* **TradeLedger Durable Object** – persists user trades, maintains composite indexes, derives GBP valuations (including Frankfurter lookups when only ZAR is provided), enforces locking, and exposes HMRC endpoints that apply same-day, 30-day, and Section 104 share-matching rules.
* **React SPA (`app/`)** – dashboard with per-asset and combined uPlot charts, recent data tables, calculators, FX converters, position sizer, trade entry/editor, CSV export, tax reports, and a diagnostics-aware health strip. User preferences persist via `useLocalSettings`.
* **Data sources** – market data from `svc-arbi-ingestor`'s Durable Object, and live Frankfurter quotes (client for converters, server for missing FX when valuing trades).

## Prerequisites

* Node.js 20.x
* npm
* Cloudflare Wrangler (installed via `npm install`)

## Setup

```bash
cd svc-arbi-dash
npm install
# configure Cloudflare secret (only once per environment)
npx wrangler secret put AUTH_TOKEN
```

## Local development

1. Build the client bundle once so Wrangler can serve the assets:
   ```bash
   npm run build
   ```

2. In a separate terminal, run the Worker in dev mode:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:8787/dash?auth=<your-token>`.

3. The dashboard auto-refreshes every minute, defaulting to a 24h history window. Use the Settings drawer to adjust history, fees, balances, slippage caps, and persistence profiles.

## Testing

Vitest covers calculator helpers and HMRC share-matching logic.

```bash
npm test
```

## Build & Deploy

* Build: `npm run build` (runs `vite build` and `wrangler build`).
* Deploy: `npm run deploy` (Cloudflare Wrangler deploy).

## Worker configuration

`wrangler.json` binds the shared `TRADE_STORE` DO (from `svc-arbi-ingestor`) and the local `TRADE_LEDGER` DO, with migrations for the ledger only. Static assets are served from `app/dist` via Wrangler's assets binding. All routes enforce `?auth=<token>` and return 404 if missing or invalid.

## Features

* **Dashboard** – header tiles with current arbitrage stats, health strip diagnostics, per-asset and combined charts (nominal vs. effective arbitrage, Luno/Kraken legs), recent sample table with filters and CSV export, calculators, FX converters (60s cache), position sizer, and explain-spike modal.
* **Trades** – Durable Object-backed trade CRUD with locking, GBP valuation enforcement (Frankfurter fallback), CSV export, and multi-locking controls. Form auto-prefills FX when only ZAR price is supplied.
* **Tax reports** – HMRC same-day → 30-day → Section 104 matching, disposal breakdowns, totals by asset, Section 104 pool balances, and CSV exports. Preview endpoints support arbitrary date windows.
* **Security** – `AUTH_TOKEN` secret stored via Wrangler. Every route requires the query param and emits 404 otherwise. No secrets are committed.

## Data privacy & disclaimer

All trade data stays within the configured Cloudflare account in the `TradeLedger` Durable Object. Frankfurter requests contain only FX symbols; no personal data leaves the Worker. HMRC calculations are deterministic but provided for guidance only – **this tool is not tax advice**.
