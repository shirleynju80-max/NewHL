import type {
  EtfDefinition,
  EtfParams,
  OhlcBar,
  ParamStrategyVariant,
} from "../types";
import { bondMap, buildBondSeries } from "./bonds";

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - n);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function genOhlc(
  dates: string[],
  seed: number,
  start: number,
  drift: number,
): OhlcBar[] {
  const rnd = mulberry32(seed);
  let c = start;
  return dates.map((date) => {
    const ch = (rnd() - 0.48) * 0.02 + drift / dates.length;
    const o = c;
    c = Math.max(0.5, c * (1 + ch));
    const wick = rnd() * 0.01 * c;
    const h = c + wick;
    const l = Math.max(0.3, c - wick * 1.2);
    return { date, open: o, high: h, low: l, close: c };
  });
}

export const tradeDates = genDates(200);
export const bondSeries = buildBondSeries(tradeDates);
export const bondByDate = bondMap(bondSeries);

const barsA = genOhlc(tradeDates, 11, 1.12, 0.08);
const barsH = genOhlc(tradeDates, 22, 8.5, -0.15);
const barsCf = genOhlc(tradeDates, 33, 102, 0.02);

const params515080MaFast: EtfParams = {
  ma_variants: [
    { variant_id: "ma_fast", fast: 5, slow: 20 },
    { variant_id: "ma_alt", fast: 8, slow: 34 },
  ],
  rsi_variants: [
    { variant_id: "rsi_std", period: 14, overbought: 72, oversold: 28 },
    { variant_id: "rsi_slow", period: 21, overbought: 75, oversold: 25 },
  ],
  bollinger_variants: [
    { variant_id: "bb_20_2", period: 20, stdDev: 2 },
    { variant_id: "bb_26_2", period: 26, stdDev: 2.1 },
  ],
  strategy_ma_ids: ["ma_fast", "ma_fast"],
  strategy_rsi_id: "rsi_std",
};

const params515080MaAlt: EtfParams = {
  ...params515080MaFast,
  strategy_ma_ids: ["ma_alt", "ma_alt"],
};

const paramVariants515080: ParamStrategyVariant[] = [
  {
    key: "515080|ma520",
    label: "MA 5/20（金叉死叉）",
    strategyId: "str_ma_cn",
    paramVersion: "2025-04-01",
    params: params515080MaFast,
  },
  {
    key: "515080|ma834",
    label: "MA 8/34（慢线）",
    strategyId: "str_ma_cn",
    paramVersion: "2025-04-01-alt",
    params: params515080MaAlt,
  },
];

export const etfDefinitions: EtfDefinition[] = [
  {
    meta: {
      code: "515080",
      name: "中证红利 ETF（示例）",
      strategy_id: "str_ma_cn",
      param_version: "2025-04-01",
      product_kind: "红利_含股息分红",
      dividend_market_scope: "A股红利",
      div_yield_nominal_pct: 5.42,
      div_yield_source: "基金披露",
      doc_links: [
        {
          label: "中证红利编制方案（参考）",
          href: "https://finance.sina.com.cn/money/fund/jjh/2022-10-14/doc-imqqsmrp2548966.shtml",
        },
      ],
    },
    params: params515080MaFast,
    paramVariants: paramVariants515080,
    bars: barsA,
  },
  {
    meta: {
      code: "513630",
      name: "港股高股息 ETF（示例）",
      strategy_id: "str_ma_hk",
      param_version: "2025-04-01",
      product_kind: "红利_含股息分红",
      dividend_market_scope: "港股红利",
      div_yield_nominal_pct: 7.85,
      div_yield_source: "指数发布",
      investor_channel: "港股通",
      div_yield_after_tax_est_pct: 6.28,
      tax_assumption_note: "示例：港股通红利税口径为示意，非税务建议。",
      fx_ccy: "HKD",
      doc_links: [
        {
          label: "港股分红税梳理（参考）",
          href: "https://www.jiemian.com/article/13720733.html",
        },
      ],
    },
    params: {
      ma_variants: [{ variant_id: "ma_hk", fast: 5, slow: 30 }],
      rsi_variants: [
        { variant_id: "rsi_hk", period: 14, overbought: 70, oversold: 30 },
      ],
      bollinger_variants: [{ variant_id: "bb_hk", period: 20, stdDev: 2 }],
      strategy_ma_ids: ["ma_hk", "ma_hk"],
      strategy_rsi_id: "rsi_hk",
    },
    bars: barsH,
  },
  {
    meta: {
      code: "508000",
      name: "现金流类示例 REIT/产品",
      strategy_id: "str_cf_demo",
      param_version: "2025-04-01",
      product_kind: "现金流类",
      div_yield_nominal_pct: 0,
      div_yield_source: "估算",
    },
    params: {
      ma_variants: [{ variant_id: "ma_cf", fast: 10, slow: 40 }],
      rsi_variants: [
        { variant_id: "rsi_cf", period: 14, overbought: 70, oversold: 30 },
      ],
      bollinger_variants: [{ variant_id: "bb_cf", period: 20, stdDev: 2 }],
      strategy_ma_ids: ["ma_cf", "ma_cf"],
    },
    bars: barsCf,
  },
];

export function getEtf(code: string): EtfDefinition | undefined {
  return etfDefinitions.find((e) => e.meta.code === code);
}
