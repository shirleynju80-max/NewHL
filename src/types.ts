export type ProductKind = "红利_含股息分红" | "现金流类";
export type DividendMarketScope = "A股红利" | "港股红利";
export type DivYieldSource = "基金披露" | "指数发布" | "估算";
export type BondAnchorId = "CN_10Y" | "US_10Y";
export type InvestorChannel = "港股通" | "QDII" | "其他";

export type MaVariant = {
  variant_id: string;
  fast: number;
  slow: number;
};

export type RsiVariant = {
  variant_id: string;
  period: number;
  overbought: number;
  oversold: number;
};

export type BollingerVariant = {
  variant_id: string;
  period: number;
  stdDev: number;
};

export type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TradePoint = {
  date: string;
  side: "BUY" | "SELL";
  price: number;
  reason: string;
  param_version: string;
  holdDays?: number;
  pnlPct?: number;
};

export type SignalLedgerRow = {
  id: string;
  etfCode: string;
  date: string;
  side: "BUY" | "SELL" | "HOLD";
  state: "new" | "active" | "expired" | "executed";
  phase: "intraday_hint" | "close_confirmed";
  trigger_reason: string;
  nDayReturn?: number;
  maxFloatPct?: number;
  minFloatPct?: number;
};

export type EtfMeta = {
  code: string;
  name: string;
  strategy_id: string;
  param_version: string;
  product_kind: ProductKind;
  dividend_market_scope?: DividendMarketScope;
  div_yield_nominal_pct: number;
  div_yield_source: DivYieldSource;
  /** 港股税后等 */
  investor_channel?: InvestorChannel;
  div_yield_after_tax_est_pct?: number;
  tax_assumption_note?: string;
  fx_ccy?: string;
  /** 参考链接 */
  doc_links?: { label: string; href: string }[];
};

export type EtfParams = {
  ma_variants: MaVariant[];
  rsi_variants: RsiVariant[];
  bollinger_variants: BollingerVariant[];
  /** 策略引用的 variant id */
  strategy_ma_ids: [string, string];
  strategy_rsi_id?: string;
};

/** 单套可切换的策略参数（多来自 etf_params 多行或 mock） */
export type ParamStrategyVariant = {
  key: string;
  label: string;
  strategyId: string;
  paramVersion: string;
  params: EtfParams;
};

export type RegisteredStrategyKind = "ma" | "rsi" | "boll";

/** 用户在「参数回测」页加入注册的策略快照（localStorage 持久化） */
export type UserRegisteredStrategy = {
  id: string;
  etfCode: string;
  label: string;
  strategyType: RegisteredStrategyKind;
  strategyId: string;
  paramVersion: string;
  params: EtfParams;
  createdAt: string;
};

export type EtfDefinition = {
  meta: EtfMeta;
  params: EtfParams;
  bars: OhlcBar[];
  /** 多组参数时展示下拉；缺省则仅当前 params */
  paramVariants?: ParamStrategyVariant[];
};

/** 一轮完整买卖（明细表一行） */
export type RoundTripDetail = {
  round: number;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  buyNav: number;
  sellNav: number;
  buyTrigger: string;
  sellTrigger: string;
  pnlPct: number;
  holdDays: number;
};

export type BondSeriesPoint = {
  date: string;
  cn10y_pct: number;
  us10y_pct: number;
};

export type AlertSnapshot = {
  etfCode: string;
  asOf: string;
  data_timestamp: string;
  intraday: {
    phase: "intraday_hint";
    side: "BUY" | "SELL" | "HOLD";
    strength: number;
    distance_to_buy_pct?: number;
    distance_to_sell_pct?: number;
    last_price: number;
  } | null;
  close: {
    phase: "close_confirmed";
    side: "BUY" | "SELL" | "HOLD";
    strength: number;
    distance_to_buy_pct?: number;
    distance_to_sell_pct?: number;
  } | null;
};
