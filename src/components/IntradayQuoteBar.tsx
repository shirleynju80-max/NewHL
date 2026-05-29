import type { LiveQuote } from "../lib/liveQuote";
import {
  formatQuoteDataUpdateLine,
  formatQuotePriceLabel,
  resolveQuoteTradeDate,
} from "../lib/liveQuote";
import type { OhlcBar } from "../types";

type IntradayQuoteBarProps = {
  quote: LiveQuote | null;
  loading: boolean;
  lastClose: number;
  bars: OhlcBar[];
  compact?: boolean;
};

export function IntradayQuoteBar({
  quote,
  loading,
  lastClose,
  bars,
  compact,
}: IntradayQuoteBarProps) {
  const display = quote?.price ?? lastClose;
  const priceLabel = formatQuotePriceLabel(quote?.source ?? null);
  const tradeDate = resolveQuoteTradeDate(quote, bars);

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <div>
          <p className="text-xs text-fin-muted">{priceLabel}</p>
          <p className="font-mono text-lg font-semibold text-[var(--fin-text)]">
            {loading && !quote ? "加载中…" : display.toFixed(4)}
          </p>
        </div>
        <p className="text-xs text-fin-muted">
          昨收{" "}
          <span className="font-mono fin-muted-text">
            {lastClose.toFixed(4)}
          </span>
        </p>
      </div>
      <p className="text-[10px] leading-relaxed text-fin-muted">
        {formatQuoteDataUpdateLine(tradeDate)}
      </p>
    </div>
  );
}
