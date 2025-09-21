// src/index.ts

interface Env {
	LUNO_KEY_ID: string;
	LUNO_KEY_SECRET: string;
}
interface Env {
	TRADE_STORE: DurableObjectNamespace;
}

type CandleObject = {
	timestamp: number;
	open: string;
	high: string;
	low: string;
	close: string;
	volume: string;
};

type LunoCandlesResponse = {
	pair: "ETHZAR";
	duration: 300;
	candles: CandleObject[];
};

export default {
	async fetch(req: Request) {
		const url = new URL(req.url);
		url.pathname = "/__scheduled";
		url.searchParams.set("cron", "* * * * *");
		return new Response(
			`To test the scheduled handler, run:\n  curl "${url.href}"\n`
		);
	},

	async scheduled(event: ScheduledController, env: Env) {
		try {
			// 1) FX GBP→ZAR
			const fx = await fetch("https://api.frankfurter.app/latest?from=GBP&to=ZAR")
				.then(r => r.json())
				.then(d => Number(d.rates.ZAR));

			// 2) Luno top of book (ZAR)
			const obTop = await fetch("https://api.luno.com/api/1/orderbook_top?pair=ETHZAR")
				.then(r => r.json());
			const lunoBestAskZAR = Number(obTop.asks?.[0]?.price); // taker buy on Luno

			// 3) Kraken ticker (GBP)
			const k = await fetch("https://api.kraken.com/0/public/Ticker?pair=ETHGBP")
				.then(r => r.json());
			const key = Object.keys(k.result ?? {})[0];
			const krakenAskGBP = Number(k.result[key].a[0]); // best ask (buy here)
			const krakenBidGBP = Number(k.result[key].b[0]); // best bid (sell here)

			// Convert Kraken quotes to ZAR
			const krakenAskZAR = krakenAskGBP * fx;
			const krakenBidZAR = krakenBidGBP * fx;

			// Edges (no fees, no slippage)
			const buyBenchmarkEdgePct = 100 * (krakenAskZAR - lunoBestAskZAR) / krakenAskZAR; // ask vs ask
			const arbEdgePct = 100 * (krakenBidZAR - lunoBestAskZAR) / krakenBidZAR; // bid vs ask

			console.log({
				fx,
				lunoBestAskZAR,
				krakenAskGBP, krakenBidGBP,
				krakenAskZAR, krakenBidZAR,
				buyBenchmarkEdgePct,
				arbEdgePct
			});



		} catch (err: any) {
			console.error("scheduled() error:", err?.message || err);
		}
	},
} satisfies ExportedHandler<Env>;

// ---------- helpers (strictly for the object-shaped Luno response) ----------

async function getGbpZar(): Promise<number> {
	const res = await fetch(
		"https://api.frankfurter.app/latest?from=GBP&to=ZAR",
		{ headers: { Accept: "application/json" } }
	);
	if (!res.ok) throw new Error(`FX HTTP ${res.status}: ${await res.text()}`);
	const data = (await res.json()) as { rates?: { ZAR?: number } };
	const rate = data?.rates?.ZAR;
	if (!rate || !Number.isFinite(rate)) throw new Error("Missing GBP→ZAR rate");
	return rate;
}

async function getLunoEthZarLatestClose(
	env: Env
): Promise<{ ts: number; close: number } | null> {
	if (!env.LUNO_KEY_ID || !env.LUNO_KEY_SECRET) {
		throw new Error("Missing LUNO_KEY_ID / LUNO_KEY_SECRET secrets");
	}
	// choose an allowed duration (seconds). 60 = 1m, 300 = 5m, etc.
	const duration = 60;
	const Dms = duration * 1000;

	// snap to candle boundary so we don't hit an "in-progress" bucket
	const now = Date.now();
	const currentBucketStart = Math.floor(now / Dms) * Dms;
	const since = currentBucketStart - Dms; // start of the *previous* full candle
	console.log(since);

	const auth = "Basic " + btoa(`${env.LUNO_KEY_ID}:${env.LUNO_KEY_SECRET}`);
	const url = `https://api.luno.com/api/exchange/1/candles?pair=ETHZAR&since=${since}&duration=${duration}`;

	const res = await fetch(url, {
		headers: {
			Authorization: auth,
			Accept: "application/json",
			"User-Agent": "svc-arbi-oracle/1.0 (Cloudflare Worker)",
		},
	});
	if (!res.ok) throw new Error(`Luno HTTP ${res.status}: ${await res.text()}`);

	const body = (await res.json()) as LunoCandlesResponse;
	console.log(body);

	// Expect EXACT shape:
	// {"pair":"ETHZAR","duration":300,"candles":[{timestamp:number, open:string, high:string, low:string, close:string, volume:string}, ...]}
	const candles = body.candles ?? [];
	if (candles.length === 0) return null;

	const latest = candles.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
	const ts = Number(latest.timestamp);
	const close = Number(latest.close);

	if (!Number.isFinite(ts) || !Number.isFinite(close)) return null;
	return { ts, close };
}
