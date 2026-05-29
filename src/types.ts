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

export type IndicatorCadence = "1d" | "1w";

export type RsiVariant = {
  variant_id: string;
  period: number;
  overbought: number;
  oversold: number;
  /** 缺省日频；登记参数可由 etf_params.note（如「RSI周」）指定 */
  cadence?: IndicatorCadence;
};

export type BollingerVariant = {
  variant_id: string;
  period: number;
  stdDev: number;
  /** 缺省日频；登记参数可由 etf_params.note（如「布林周」）指定 */
  cadence?: IndicatorCadence;
};

/**
 * MA 自定义：收盘价上穿 MA(buyMaPeriod) 买入。
 * 卖出为「止盈」与「高点回撤」二选一（满足任一即卖，非需同时满足）。
 */
export type MaCustomRule = {
  buyMaPeriod: number;
  profitTakePct: number;
  trailDrawdownPct: number;
};

export type OhlcBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 可选：按交易日的名义股息率（%）。缺省则利差等用 etfs.csv 的 div_yield_nominal_pct 并前向填充逻辑。 */
  div_yield_nominal_pct?: number;
};

export type TradePoint = {
  date: string;
  side: "BUY" | "SELL";
  price: number;
  reason: string;
  param_version: string;
  /** 持仓中再次 BUY：刷新成本基准，不新开仓 */
  refresh?: boolean;
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
  /** 仅 MA 自定义策略（strategy_id 含 ma_custom）使用 */
  ma_custom_rule?: MaCustomRule;
};

/** 单套可切换的策略参数（多来自 etf_params 多行或 mock） */
export type ParamStrategyVariant = {
  key: string;
  label: string;
  strategyId: string;
  paramVersion: string;
  params: EtfParams;
};

export type RegisteredStrategyKind = "ma" | "ma_custom" | "rsi" | "boll";

/** 用户在「策略研究」页加入注册的策略快照（localStorage 持久化） */
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

export type IndexMarket = "A" | "H";
export type IndexCategory = "A股红利" | "港股红利" | "现金流" | "价值" | "宽基";

export type IndexMeta = {
  index_code: string;
  name: string;
  market: IndexMarket;
  category: IndexCategory;
  methodology_summary: string;
  methodology_url?: string;
  /** 无按日股息率列时的利差回退（%） */
  fallback_div_yield_pct?: number;
  /** 指数成立日 YYYY-MM-DD（用于筛选） */
  inception_date?: string;
  /** 基日 YYYY-MM-DD */
  base_date?: string;
  /** 基点 */
  base_value?: number;
  /** 启用/发布日期 YYYY-MM-DD */
  launch_date?: string;
  /** 加权方式 */
  weighting_method?: string;
  /** 调样频率 */
  rebalancing_frequency?: string;
};

export type IndexBar = {
  date: string;
  tri_close: number;
  price_close?: number;
  div_yield_nominal_pct?: number;
  /** Red-Rocket 历史分位（%），与 div_yield_nominal_pct 同日观测；缺则本地按名义股息率序列计算 */
  div_yield_redrocket_percentile_pct?: number;
};

export type IndexDefinition = {
  meta: IndexMeta;
  bars: IndexBar[];
};

/** 跟踪产品类型：场内 ETF/LOF 可链 ETF 看板；场外基金仅展示与外链 */
export type IndexTrackingProductType = "etf" | "otc_fund";

export type IndexTrackingRow = {
  index_code: string;
  etf_code: string;
  /** etf（默认）| otc_fund；也可在 note 中写「场外」推断 */
  product_type?: IndexTrackingProductType;
  note?: string;
  fee_pct?: number;
  listed_date?: string;
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
