import type { LiveQuote } from "../lib/liveQuote";
import { formatQuoteFetchedAt, formatQuoteSourceLabel } from "../lib/liveQuote";

type IntradayQuoteBarProps = {
 quote: LiveQuote | null;
 loading: boolean;
 lastClose: number;
 onRefresh: () => void;
 compact?: boolean;
};

export function IntradayQuoteBar({ quote, loading, lastClose, onRefresh, compact }: IntradayQuoteBarProps) {
 const display = quote?.price ?? lastClose;
 return (
 <div className={compact ? "space-y-2" : "space-y-3"}>
 <div className="flex flex-wrap items-end gap-3">
 <div>
 <p className="text-xs text-fin-muted">最新价（实时拉取）</p>
 <p className="font-mono text-lg font-semibold text-[var(--fin-blue)]">
 {loading && !quote ? "拉取中…" : display.toFixed(4)}
 </p>
 </div>
 <button
 type="button"
 onClick={() => onRefresh()}
 disabled={loading}
 className="rounded-full border border-fin-border bg-white px-3 py-1 text-xs font-medium fin-muted-text hover:bg-fin-panel-muted disabled:opacity-50"
 >
 {loading ? "刷新中…" : "刷新行情"}
 </button>
 <p className="text-xs text-fin-muted">
 昨收 <span className="font-mono fin-muted-text">{lastClose.toFixed(4)}</span>
 </p>
 </div>
 {quote ?
 <p className="text-[10px] leading-relaxed text-fin-muted">
 数据更新：{formatQuoteFetchedAt(quote.fetchedAt)} · {formatQuoteSourceLabel(quote.source)} · 交易日{" "}
 {quote.tradeDate}
 {quote.detail ? ` · ${quote.detail}` : null}
 </p>
 : null}
 </div>
 );
}
