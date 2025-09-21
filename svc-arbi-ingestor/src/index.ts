// src/index.ts

interface Env {
	LUNO_KEY_ID: string;
	LUNO_KEY_SECRET: string;
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
			const fx = await getGbpZar();
			const last = await getLunoEthZarLatestClose(env);

			const priceZAR = last?.close ?? undefined;
			const priceGBP = priceZAR && fx ? priceZAR / fx : undefined;

			console.log(
				JSON.stringify(
					{
						cron: event.cron,
						ts: new Date().toISOString(),
						fx: { gbp_zar: fx },
						luno: {
							pair: "ETHZAR",
							last_candle_time: last ? new Date(last.ts).toISOString() : null,
							close_zar: priceZAR ?? null,
							derived_close_gbp: priceGBP ?? null,
						},
					},
					null,
					2
				)
			);
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
