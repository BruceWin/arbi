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
- `GET /data` → proxy to `TRADE_STORE` DO `/data` (supports `?limit=&cursor=`)
- Trade Ledger API:
  - `GET /trades`
  - `POST /trades`
  - `GET /trades/:id`
  - `PUT /trades/:id`
  - `DELETE /trades/:id`
  - `POST /trades/lock`
  - `GET /tax/summary?taxYear=YYYY-YY`
  - `GET /tax/preview?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Headers for all successful responses
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.

## Worker config (`/svc-arbi-dash/wrangler.json`)
- Name: `svc-arbi-dash`
- `main`: `src/index.ts`
- `compatibility_date`: `2025-09-21`
- Durable Object bindings: `TRADE_STORE` (cross-script), `TRADE_LEDGER` (local)
- Migrations: only `TradeLedger` (tag: `trade-ledger-v1`)

## React app (`/svc-arbi-dash/app`)
- Vite + React + TypeScript + Tailwind.
- Charts with uPlot (downsampling, zoom/pan).
- Timezone: `Europe/London`, 24-hour `DD MMM YYYY, HH:mm:ss`.

### App structure
/app
index.html
/src
main.tsx
App.tsx
/components
HeaderTiles.tsx
HealthStrip.tsx
AssetChart.tsx
CombinedChart.tsx
RecentTable.tsx
Calculators.tsx
PositionSizer.tsx
SettingsDrawer.tsx
ExportCsvButton.tsx
ExplainSpikeModal.tsx
TradesForm.tsx
TradesTable.tsx
TaxReports.tsx
/hooks
useDataWindow.ts
useFrankfurter.ts
useLocalSettings.ts
/lib
calc.ts
csv.ts
time.ts
types.ts
hmrc.ts
fx.ts
/styles
index.css
tailwind.config.js
tsconfig.json
vite.config.ts

markdown
Copy code

## Functional requirements (summary)
- **Dashboard**: per-asset charts (Luno ZAR, Kraken GBP & ZAR-converted via per-sample `fx_gbp_zar`), nominal & effective arb %, combined chart (top direction per asset + FX overlay), recent table, calculators (two-value % diff), ZAR↔GBP & ZAR↔USD converters (Frankfurter live, 60s cache), Position Sizer, CSV export, health strip. Auto-refresh every 1 minute; initial window 24h; load older via `nextCursor`.
- **Trade history**: new DO `TradeLedger`, CRUD UI, CSV export, GBP valuation rules (prefer GBP; else ZAR/FX; fetch Frankfurter day rate only if user gave ZAR without FX), fees (GBP/ZAR/ASSET conversion), lockable records.
- **HMRC tax**: server-side compute (same-day, 30-day, Section 104 pool), `GET /tax/summary`, `GET /tax/preview`. Output DisposalReports + totals + pool balances; CSV export.

## Calculations
- Effective arb % = nominal − (fees per leg) − (slippage per leg) − (optional withdrawal amortization).
- Percentage difference: absolute, relative %, and pp (guard v1=0).
- Position sizing: top-of-book + slippage; K→L bound by GBP balance; L→K by ZAR balance.

## Defaults (editable via Settings)
- Fees:
  - Luno: USDT 0.20% taker / −0.01% maker; ETH 0.60% taker / 0.40% maker; BTC 0.60% taker / 0.40% maker
  - Kraken: USDT 0.20% taker / 0.20% maker; ETH 0.40% taker / 0.25% maker; BTC 0.40% taker / 0.25% maker
- Withdrawal fees:
  - BTC: Luno 0.00006, Kraken 0.00020
  - ETH (ERC-20): Luno 0.0030, Kraken 0.0030
  - USDT (ERC-20): Luno 15, Kraken 15
- Networks: ETH ERC-20; USDT ERC-20
- Slippage caps per leg: ETH 0.10%, BTC 0.10%, USDT 0.05%
- Balances: Luno **R100,000**, Kraken **£5,000**
- Auto-refresh: 1 minute; Initial history: 24h; Dark mode default.

## External calls
- Frankfurter (client): `GBP→ZAR`, `USD→ZAR` (cache 60s; show last updated).
- Frankfurter (server): only to resolve GBP when user supplied ZAR price without FX.
- Market DO: forward `/data` to `TRADE_STORE` DO `/data`.

## Root files inside `/svc-arbi-dash`
- `/wrangler.json` (bindings + migrations)
- `/worker/src/index.ts` (router, DO stubs, asset serving)
- `/package.json` scripts:
  ```json
  {
    "scripts": {
      "dev": "wrangler dev",
      "build": "vite build && wrangler build",
      "deploy": "wrangler deploy",
      "test": "vitest run"
    }
  }
/tsconfig.json (strict)

/.eslintrc.cjs (TS + recommended)

/tests/calc.spec.ts and /tests/hmrc.spec.ts

/README.md (how to run, set AUTH_TOKEN, deploy, disclaimers)

Acceptance criteria (must all pass)
All routes require ?auth; invalid/missing → 404.

Dashboard shows last 24h, loads older via nextCursor, auto-refresh 1 min; charts & combined chart behave as specified.

Effective arb % properly reflects fees, slippage, and optional withdrawal amortization.

Converters use Frankfurter with 60s cache and show quote time.

TradeLedger CRUD works; ZAR-only price auto-prefills FX; derived GBP values stored; locking enforced.

HMRC summary applies same-day → 30-day → Section 104; outputs disposal lines, totals, pool balances; CSV export works.

Tests run with vitest and cover calc.ts and core HMRC matching logic.

No alerting code in this service.
