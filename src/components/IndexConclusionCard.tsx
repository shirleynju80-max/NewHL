import { Link } from "react-router-dom";
import {
  buildIndexSpreadRows,
  indexDividendYieldSnapshot,
  indexSeriesForMode,
} from "../data/indexCsv";
import {
  bondAnchorShortLabel,
  resolveBondAnchorForIndex,
} from "../lib/bondAnchor";
import type { BondAnchorId } from "../types";
import {
  dataAvailabilityLabel,
  dataAvailabilityTone,
  dividendAllocationObservation,
  indexDataAvailability,
  indexToConfigDimension,
} from "../lib/configFramework";
import { EtfProductCodeLink } from "./EtfProductDetailLink";
import { etfDashboardHref } from "../lib/etfListingAge";
import { formatPct } from "../lib/formatDisplay";
import type { EtfProductRecord } from "../lib/etfProducts";
import { buildIndexOverviewFromSeries } from "../lib/indexPanelMetrics";
import type { BondSeriesPoint, EtfDefinition, IndexDefinition } from "../types";

function spreadPercentile(rows: { spreadPct: number }[]): number | null {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1]!.spreadPct;
  const sorted = rows
    .map((r) => r.spreadPct)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const le = sorted.filter((v) => v <= latest).length;
  return Math.round((le / sorted.length) * 100);
}

export function IndexConclusionCard({
  def,
  bondByDate,
  primaryProduct,
  primaryEtf,
  bondAnchor: bondAnchorProp,
}: {
  def: IndexDefinition;
  bondByDate: Record<string, BondSeriesPoint>;
  primaryProduct?: EtfProductRecord;
  primaryEtf?: EtfDefinition;
  bondAnchor?: BondAnchorId;
}) {
  const dim = indexToConfigDimension(def.meta.category);
  const avail = indexDataAvailability(def);
  const availTone = dataAvailabilityTone(avail);

  if (dim === "shareholder_return") {
    const bondAnchor = bondAnchorProp ?? resolveBondAnchorForIndex(def);
    const bondLabel = bondAnchorShortLabel(bondAnchor);
    const spreadRows = buildIndexSpreadRows(def, bondByDate, bondAnchor);
    const latest = spreadRows.at(-1);
    const spreadPctile = spreadPercentile(spreadRows);
    const divSnap = indexDividendYieldSnapshot(def.bars);
    const obs = dividendAllocationObservation(
      latest?.spreadPct,
      divSnap.latestYieldPct ?? latest?.divYieldPct,
    );

    return (
      <section className="fin-panel border-l-[3px] border-l-[var(--fin-up)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium fin-muted-text">研究结论</p>
            <p
              className={`mt-1 inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold ${obs.tone}`}
            >
              {obs.title}
            </p>
          </div>
          {primaryProduct ? (
            <p className="text-sm fin-muted-text">
              主跟踪{" "}
              <EtfProductCodeLink
                product={primaryProduct}
                etf={primaryEtf}
                className="font-mono font-semibold fin-link"
              />
            </p>
          ) : null}
        </div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs fin-muted-text">最新股息率</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
              {formatPct(divSnap.latestYieldPct)}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">股息率历史分位</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
              {formatPct(divSnap.yieldPercentilePct)}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">
              股债利差（vs {bondLabel}）
            </dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
              {formatPct(latest?.spreadPct)}
            </dd>
          </div>
          <div>
            <dt className="text-xs fin-muted-text">利差历史分位</dt>
            <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
              {formatPct(spreadPctile)}
            </dd>
          </div>
        </dl>
        {obs.body ? (
          <p className="mt-3 text-sm fin-muted-text">{obs.body}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {primaryProduct ? (
            <>
              <Link
                to={etfDashboardHref(
                  primaryProduct.code,
                  "intraday",
                  primaryEtf,
                  primaryProduct,
                )}
                className="fin-link"
              >
                盘中监控
              </Link>
              <Link
                to={etfDashboardHref(
                  primaryProduct.code,
                  "backtest",
                  primaryEtf,
                  primaryProduct,
                )}
                className="fin-link"
              >
                策略回测
              </Link>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  const tri = indexSeriesForMode(def.bars, "tri");
  const overview = buildIndexOverviewFromSeries(
    tri,
    def.meta.index_code,
    def.meta.name,
  );
  const y5 = overview?.y5 ?? null;
  const allFallback = !y5 ? (overview?.all ?? null) : null;
  const perfBlock = y5 ?? allFallback;
  const perfLabel = y5
    ? "近5年年化（全收益）"
    : allFallback
      ? "全样本年化（近5年不足）"
      : "近5年年化（全收益）";

  return (
    <section className="fin-panel border-l-[3px] border-l-[var(--fin-up)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium fin-muted-text">研究结论</p>
          <p className="mt-1 text-lg font-semibold text-[var(--fin-text)]">
            质量底仓
          </p>
        </div>
        <span
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
            availTone === "good"
              ? "fin-status-good border-transparent bg-transparent px-0"
              : availTone === "warn"
                ? "fin-alert-chip border-transparent bg-transparent px-0"
                : "border border-fin-border fin-muted-text"
          }`}
        >
          {dataAvailabilityLabel(avail)}
        </span>
      </div>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs fin-muted-text">
            {perfLabel}
            {perfBlock?.from && perfBlock?.to ? (
              <span className="mt-0.5 block font-mono text-[10px] font-normal fin-muted-text">
                {perfBlock.from} → {perfBlock.to}
              </span>
            ) : null}
          </dt>
          <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
            {formatPct(perfBlock?.annualReturnPct)}
          </dd>
        </div>
        <div>
          <dt className="text-xs fin-muted-text">最大回撤</dt>
          <dd className="mt-1 font-mono text-xl font-semibold text-[var(--fin-text)]">
            {formatPct(perfBlock?.maxDrawdownPct)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm fin-muted-text">
        关注企业持续创造现金的能力；长期表现基于指数全收益序列，实盘历史较短时请结合基日回溯理解。
      </p>
    </section>
  );
}
