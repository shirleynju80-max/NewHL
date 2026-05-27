import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import {
  buildObservationPoolColumns,
  CONFIG_DIMENSIONS,
  type DimensionCardSnapshot,
} from "../lib/configFramework";
import {
  buildCashBenchmarkComparison,
  buildCashProductCards,
  buildDividendProductCards,
  buildDividendSpreadDeskNote,
  spreadPercentileForDesk,
  type CashBenchmarkMetricRow,
} from "../lib/deskHomeData";

type ConfigDeskOverviewProps = {
  shareholderCard: DimensionCardSnapshot;
};

const SPREAD_FORMULA_HINT =
  "股债利差 = 中证红利指数股息率 - 10年国债收益率";

const CONFIG_PRINCIPLES = [
  {
    num: 1,
    title: "不单押一种风格",
    body: "现金创造偏质量底仓候选，股东回报偏现金释放；二者角色不同，宜搭配观察而非单押。",
  },
  {
    num: 2,
    title: "分批定投",
    body: "底仓拉长持有周期，宜季度或月度分批买入，并定期再平衡，避免一次性重仓。",
  },
  {
    num: 3,
    title: "数据成熟度",
    body: "FCF 类指数实盘历史较短，回测需审慎；红利与股债利差口径相对更成熟。",
  },
] as const;

const DESK_FOOTNOTE = "历史表现不代表未来，不构成投资建议";

function shareholderStatusBadgeClass(
  tone: DimensionCardSnapshot["tone"],
): string {
  if (tone === "good") return "ft-badge ft-badge--success";
  if (tone === "warn") return "ft-badge ft-badge--warn";
  return "ft-badge";
}

function compareBarWidth(a: number, b: number, value: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 0.01);
  return Math.min(100, (Math.abs(value) / scale) * 100);
}

function compareValueClass(row: CashBenchmarkMetricRow, side: "fcf" | "hs300"): string {
  const value = side === "fcf" ? row.fcfValue : row.hs300Value;
  const better = side === "fcf" ? row.fcfBetter : !row.fcfBetter;
  if (row.kind === "return") {
    if (value > 0) return "ft-compare-value ft-compare-value--up";
    if (value < 0) return "ft-compare-value ft-compare-value--down";
    return "ft-compare-value";
  }
  if (row.kind === "drawdown") {
    return better
      ? "ft-compare-value ft-compare-value--favorable"
      : "ft-compare-value ft-compare-value--unfavorable";
  }
  return "ft-compare-value";
}

function compareBarClass(row: CashBenchmarkMetricRow, side: "fcf" | "hs300"): string {
  const value = side === "fcf" ? row.fcfValue : row.hs300Value;
  const better = side === "fcf" ? row.fcfBetter : !row.fcfBetter;
  if (row.kind === "return") {
    if (value > 0) return "ft-compare-bar-fill ft-compare-bar-fill--up";
    if (value < 0) return "ft-compare-bar-fill ft-compare-bar-fill--down";
    return "ft-compare-bar-fill";
  }
  if (row.kind === "drawdown") {
    return better
      ? "ft-compare-bar-fill ft-compare-bar-fill--favorable"
      : "ft-compare-bar-fill ft-compare-bar-fill--unfavorable";
  }
  return "ft-compare-bar-fill";
}

function CompareMetricCell({
  row,
  side,
}: {
  row: CashBenchmarkMetricRow;
  side: "fcf" | "hs300";
}) {
  const value = side === "fcf" ? row.fcfValue : row.hs300Value;
  const display = side === "fcf" ? row.fcf : row.hs300;
  return (
    <div className="ft-compare-cell">
      <span className={compareValueClass(row, side)}>{display}</span>
      {row.showCompareBar ? (
        <div className="ft-compare-bar" aria-hidden>
          <div
            className={compareBarClass(row, side)}
            style={{ width: `${compareBarWidth(row.fcfValue, row.hs300Value, value)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ConfigDeskOverview({
  shareholderCard,
}: ConfigDeskOverviewProps) {
  const { indices, bondByDate, etfProducts } = useDataSource();
  const cashDim = CONFIG_DIMENSIONS.cash_creation;
  const divDim = CONFIG_DIMENSIONS.shareholder_return;

  const comparison = buildCashBenchmarkComparison(indices);
  const cashProducts = buildCashProductCards(etfProducts);
  const divProducts = buildDividendProductCards(etfProducts);
  const poolColumns = buildObservationPoolColumns(indices);

  const divYield = shareholderCard.stats.find((s) => s.label === "最新股息率");
  const bond = shareholderCard.stats.find((s) => s.label === "中国10年期国债");
  const spread = shareholderCard.stats.find((s) => s.label === "股债利差");
  const pctStat = shareholderCard.stats.find((s) => s.label === "利差历史分位");
  const pctNum =
    pctStat?.value && pctStat.value !== "—"
      ? parseFloat(pctStat.value.replace(/[^\d.]/g, ""))
      : spreadPercentileForDesk(indices, bondByDate);
  const spreadDataNote = buildDividendSpreadDeskNote(indices, bondByDate);

  return (
    <div className="ft-dashboard-body space-y-8">
      <section className="ft-principle-banner" aria-label="配置框架说明">
        <p>
          <strong>价值底仓的两个观察维度：</strong>
          现金创造看企业造血能力，股东回报看现金释放。两者搭配，采用分批定投与再平衡，构建长期价值底仓。
        </p>
      </section>

      <section className="rounded-lg border border-fin-border bg-fin-panel-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ft-text)]">
              日常跟踪入口
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ft-muted)]">
              先看精选主 ETF 的收益风险与今日区间，再进入盘中监控确认执行状态。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/featured-tracking" className="ft-btn">
              查看精选跟踪
            </Link>
            <Link to="/monitor" className="fin-btn-secondary rounded-md px-4 py-2 text-sm">
              今日盘中信号
            </Link>
          </div>
        </div>
      </section>

      <div className="ft-two-columns">
        <article className="ft-card">
          <div className="ft-card-header">
            <h2 className="ft-card-title">{cashDim.title}</h2>
            <p className="ft-card-sub">自由现金流指数 · 质量底仓</p>
            <p className="mt-2">
              <span className="ft-badge">长期业绩优异</span>
            </p>
          </div>
          <div className="ft-card-body">
            <div className="ft-core-metrics ft-core-metrics--compare">
              {comparison?.metrics.length ? (
                <>
                  <table className="ft-compare-cols-table ft-compare-cols-table--data-right">
                    <colgroup>
                      <col className="ft-compare-col-label" />
                      <col className="ft-compare-col-data" />
                      <col className="ft-compare-col-data" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">指标核算</th>
                        <th scope="col">{comparison.fcfColumnLabel}</th>
                        <th scope="col">{comparison.hs300ColumnLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.metrics.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>
                            <CompareMetricCell row={row} side="fcf" />
                          </td>
                          <td>
                            <CompareMetricCell row={row} side="hs300" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {comparison.footnote ? (
                    <p className="ft-small-note">{comparison.footnote}</p>
                  ) : null}
                </>
              ) : (
                <p className="ft-small-note">
                  暂无近5年对比数据（需国证自由现金流 980092 与沪深300 000300
                  行情，且近5年样本不少于 20 个交易日）。
                </p>
              )}
            </div>

            {cashProducts.length > 0 ? (
              <>
                <p className="ft-section-label">代表性 ETF</p>
                {cashProducts.map((p) => (
                  <Link
                    key={p.etfCode}
                    to={`/etf/${encodeURIComponent(p.etfCode)}`}
                    className="ft-product-item"
                  >
                    <span>{p.name}</span>
                    <span className="ft-product-item-code">{p.etfCode}</span>
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </article>

        <article className="ft-card ft-card--tooltip-visible">
          <div className="ft-card-header">
            <h2 className="ft-card-title">{divDim.title}</h2>
            <p className="ft-card-sub">红利指数 · 股息率与股债利差</p>
            <p className="mt-2">
              <span className={shareholderStatusBadgeClass(shareholderCard.tone)}>
                {shareholderCard.statusTitle}
              </span>
            </p>
          </div>
          <div className="ft-card-body">
            <div className="ft-core-metrics ft-core-metrics--compare">
              <table className="ft-compare-cols-table ft-compare-cols-table--data-right ft-compare-cols-table--span-current">
                <colgroup>
                  <col className="ft-compare-col-label" />
                  <col className="ft-compare-col-data" />
                  <col className="ft-compare-col-data" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">指标核算</th>
                    <th scope="col" colSpan={2}>
                      当前
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" title="参考指数股息率（中证红利低波）">
                      股息率
                    </th>
                    <td colSpan={2}>
                      <span className="ft-compare-value ft-compare-value--up">
                        {divYield?.value ?? "—"}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" title="无风险利率（中国10年期国债）">
                      10年期国债
                    </th>
                    <td colSpan={2}>
                      <span className="ft-compare-value">{bond?.value ?? "—"}</span>
                    </td>
                  </tr>
                  <tr className="ft-compare-row-dual">
                    <th scope="row">
                      <span className="inline-flex items-center gap-1.5">
                        股债利差
                        <span className="ft-metric-hint-wrap">
                          <button
                            type="button"
                            className="ft-metric-hint"
                            aria-describedby="spread-formula-hint"
                          >
                            ?
                          </button>
                          <span
                            id="spread-formula-hint"
                            role="tooltip"
                            className="ft-metric-hint-popover"
                          >
                            {SPREAD_FORMULA_HINT}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td colSpan={2}>
                      <div className="ft-spread-dual-metrics">
                        <span className="ft-compare-value ft-compare-value--up">
                          {spread?.value ?? "—"}
                        </span>
                        {pctNum != null ? (
                          <span className="ft-compare-value ft-compare-percentile-hist">
                            {pctNum}%（历史分位数）
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              <p className="ft-small-note ft-spread-data-note">{spreadDataNote}</p>
            </div>

            {divProducts.length > 0 ? (
              <>
                <p className="ft-section-label">代表性 ETF</p>
                {divProducts.map((p) => (
                  <Link
                    key={p.etfCode}
                    to={`/etf/${encodeURIComponent(p.etfCode)}`}
                    className="ft-product-item"
                  >
                    <span>{p.name}</span>
                    <span className="ft-product-item-code">{p.etfCode}</span>
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </article>
      </div>

      <section
        className="ft-principles-section"
        aria-labelledby="config-principles-title"
      >
        <h3 id="config-principles-title" className="ft-principles-section-title">
          核心资产配置三条基本原则
        </h3>
        <div className="ft-principles-grid">
          {CONFIG_PRINCIPLES.map((item) => (
            <article key={item.num} className="ft-principle-card">
              <div className="ft-principle-card-head">
                <span className="ft-principle-num" aria-hidden>
                  {item.num}
                </span>
                <h4 className="ft-principle-card-title">{item.title}</h4>
              </div>
              <p className="ft-principle-card-body">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      {poolColumns.some((col) => col.chips.length > 0) ? (
        <section aria-labelledby="core-index-pool-title">
          <h3
            id="core-index-pool-title"
            className="text-[0.85rem] font-semibold text-[var(--ft-text)]"
          >
            底层核心指数池跟踪
          </h3>
          <div className="ft-pool-columns">
            {poolColumns.map((col, colIndex) => (
              <div
                key={col.title}
                className={`ft-pool-column${colIndex < poolColumns.length - 1 ? " ft-pool-column--divide" : ""}`}
              >
                <p className="ft-pool-column-title">{col.title}</p>
                <div className="ft-pool-chips">
                  {col.chips.map((chip) => (
                    <Link key={chip.code} to={chip.href} className="ft-pool-chip">
                      {chip.name}({chip.code})
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="ft-footer-note">{DESK_FOOTNOTE}</p>
    </div>
  );
}
