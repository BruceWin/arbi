export type AssetSymbol = 'ETH' | 'BTC' | 'USDT';

export type AssetSnapshot = {
  lunoBestBidZAR: number | null;
  lunoBestAskZAR: number | null;
  krakenBidGBP: number | null;
  krakenAskGBP: number | null;
  krakenBidZAR: number | null;
  krakenAskZAR: number | null;
  arb_buyKraken_sellLuno_pct: number | null;
  arb_buyLuno_sellKraken_pct: number | null;
};

export type Cycle = {
  trade: AssetSymbol;
  via: AssetSymbol;
  pct: number | null;
};

export type Sample = {
  ts: number;
  fx_gbp_zar: number;
  ETH: AssetSnapshot;
  BTC: AssetSnapshot;
  USDT: AssetSnapshot;
  cycles_from_Luno_ZAR: Cycle[];
  cycles_from_Kraken_GBP: Cycle[];
};

export type Page = {
  count: number;
  nextCursor: string | null;
  samples: Sample[];
};

export type Money = {
  amount: number;
  currency: 'GBP' | 'ZAR' | 'ASSET' | 'USD';
};

export type TradeSide = 'BUY' | 'SELL';

export type TradeVenue = 'LUNO' | 'KRAKEN' | 'OTHER' | undefined;

export type Trade = {
  id: string;
  ts: number;
  asset: AssetSymbol;
  venue?: TradeVenue;
  side: TradeSide;
  quantity: number;
  priceGBP?: number;
  priceZAR?: number;
  fx_gbp_zar?: number;
  fee?: Money;
  notes?: string;
  derived?: {
    perUnitGBP: number;
    gbpProceedsOrCost: number;
    feeGBP?: number;
    fxSource?: 'USER' | 'FRANKFURTER' | 'NONE';
  };
  locked?: boolean;
};

export type TradeFilters = {
  asset?: AssetSymbol;
  side?: TradeSide;
  from?: number;
  to?: number;
};

export type TradeListResponse = {
  count: number;
  nextCursor: string | null;
  trades: Trade[];
};

export type TaxYearSummary = {
  taxYear: string;
  totals: {
    overallGainGBP: number;
    byAsset: Record<AssetSymbol, number>;
  };
  pools: Record<AssetSymbol, { totalQty: number; totalCostGBP: number; avgCostGBP: number }>;
  disposals: DisposalReport[];
  matchLines: FlatMatchLine[];
  issues: string[];
};

export type MatchRule = 'SAME_DAY' | 'WITHIN_30_DAYS' | 'SECTION_104';

export type MatchLine = {
  rule: MatchRule;
  buyRef?: string;
  matchedQty: number;
  proceedsGBP: number;
  allowableCostGBP: number;
  gainGBP: number;
};

export type FlatMatchLine = MatchLine & {
  sellRef: string;
  asset: AssetSymbol;
  ts: number;
};

export type DisposalReport = {
  sellRef: string;
  ts: number;
  asset: AssetSymbol;
  quantity: number;
  grossProceedsGBP: number;
  disposalFeesGBP: number;
  netProceedsGBP: number;
  matches: MatchLine[];
  totalGainGBP: number;
  issues?: string[];
};

export type TaxPreviewRequest = {
  from: string;
  to: string;
};

export type TaxSummaryRequest = {
  taxYear: string;
};
