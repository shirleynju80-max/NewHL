import type { EtfDefinition, IndexBar, OhlcBar } from "../types";
import { indexSeriesForMode } from "../data/indexCsv";

/** 标普等指数：本地无官方 index_bars 全收益时，可用主跟踪 ETF 收盘价代理展示 */
export const SP_INDEX_ETF_PROXY_CODES = new Set([
  "SPAHLVCP.SPI",
  "SPCLLHCP.SPI",
]);

function closeFromIndexBar(bar: IndexBar): number {
  return bar.tri_close || bar.price_close || 0;
}

export function ohlcFromIndexBars(bars: IndexBar[]): OhlcBar[] {
  return bars
    .map((b) => {
      const close = closeFromIndexBar(b);
      return { date: b.date, open: close, high: close, low: close, close };
    })
    .filter((b) => b.close > 0);
}

function indexTriPoints(bars: IndexBar[]) {
  return indexSeriesForMode(bars, "tri").filter(
    (p) => Number.isFinite(p.value) && p.value > 0,
  );
}

export function shouldUseEtfProxyForIndex(
  indexCode: string,
  indexBars: IndexBar[] | undefined,
): boolean {
  if (!SP_INDEX_ETF_PROXY_CODES.has(indexCode)) return false;
  return indexTriPoints(indexBars ?? []).length === 0;
}

export function ohlcFromEtfBars(etf: EtfDefinition): OhlcBar[] {
  return etf.bars.filter((b) => Number.isFinite(b.close) && b.close > 0);
}

export type IndexMetricOhlcSource = {
  bars: OhlcBar[];
  usesEtfProxy: boolean;
  proxyEtfCode?: string;
};

/** 指数表现矩阵：优先 index_bars 全收益，标普缺序列时用主跟踪 ETF 收盘价 */
export function metricOhlcForIndexRow(
  indexCode: string,
  indexBars: IndexBar[] | undefined,
  primaryEtf: EtfDefinition | undefined,
): IndexMetricOhlcSource {
  if (
    shouldUseEtfProxyForIndex(indexCode, indexBars) &&
    primaryEtf?.bars.length
  ) {
    return {
      bars: ohlcFromEtfBars(primaryEtf),
      usesEtfProxy: true,
      proxyEtfCode: primaryEtf.meta.code,
    };
  }
  return {
    bars: ohlcFromIndexBars(indexBars ?? []),
    usesEtfProxy: false,
  };
}

export const SP_INDEX_ETF_PROXY_FOOTNOTE =
  "标普中国 A 股大盘红利低波 50（SPCLLHCP.SPI）、标普港股通低波红利（SPAHLVCP.SPI）等在本地无官方指数全收益序列时，「指数表现矩阵」以对应主跟踪 ETF 的前复权收盘价近似计算年化、回撤与波动；非指数原始全收益口径，仅供精选横向参考。";
