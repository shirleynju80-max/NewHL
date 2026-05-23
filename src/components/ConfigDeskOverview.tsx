import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { formatPctValue } from "../lib/formatDisplay";
import {
  CONFIG_DIMENSIONS,
  OBSERVATION_POOL_INDEX_COLUMNS,
  type CashCreationPerfLine,
  type DimensionCardSnapshot,
} from "../lib/configFramework";

type EtfPoolStats = {
  primaryCount: number;
  listedCount: number;
  poolCount: number;
};

type ConfigDeskOverviewProps = {
  cashPerfLines: CashCreationPerfLine[];
  shareholderCard: DimensionCardSnapshot;
  etfPoolStats: EtfPoolStats;
};

function parseCashY5(line: CashCreationPerfLine | undefined): { ann: string; dd: string } {
  if (!line?.summary || line.summary === "样本不足" || line.summary === "暂无行情") {
    return { ann: "—", dd: "—" };
  }
  const annRaw = line.summary.match(/年化≈([\d.-]+)/)?.[1];
  const ddRaw = line.summary.match(/最大回撤≈([\d.-]+)/)?.[1];
  const ann = annRaw != null && Number.isFinite(Number(annRaw)) ? `${formatPctValue(Number(annRaw))}%` : "—";
  const dd = ddRaw != null && Number.isFinite(Number(ddRaw)) ? `${formatPctValue(Number(ddRaw))}%` : "—";
  return { ann, dd };
}

function WhyJudgeDetails({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="fin-details mt-4">
      <summary className="[&::-webkit-details-marker]:hidden">
        <span className="mr-2 fin-muted-text" aria-hidden>
          ▸
        </span>
        {title}
      </summary>
      <div className="fin-body border-t px-4 py-3" style={{ borderColor: "var(--fin-border)" }}>
        {children}
      </div>
    </details>
  );
}

function CockpitCard({
  title,
  status,
  statusTone,
  metrics,
  cta,
  secondaryLinks,
  why,
}: {
  title: string;
  status: string;
  statusTone: "good" | "warn" | "neutral";
  metrics: { label: string; value: ReactNode; mono?: boolean }[];
  cta: { label: string; href: string };
  secondaryLinks?: { label: string; href: string }[];
  why: ReactNode;
}) {
  const statusClass =
    statusTone === "good" ? "fin-status-good" : statusTone === "warn" ? "fin-status-warn" : "fin-status-neutral";

  return (
    <article className="fin-panel flex min-w-[260px] flex-1 flex-col p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-[var(--fin-text)]">{title}</h3>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${statusClass}`}>{status}</span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {metrics.map((m) => (
          <div key={m.label}>
            <dt className="fin-label">{m.label}</dt>
            <dd className={`mt-1 text-lg font-semibold text-[var(--fin-text)] ${m.mono ? "font-mono tabular-nums" : ""}`}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link to={cta.href} className="fin-btn-primary">
          {cta.label}
        </Link>
        {secondaryLinks?.map((l) => (
          <Link key={l.href} to={l.href} className="text-sm fin-link">
            {l.label}
          </Link>
        ))}
      </div>
      <WhyJudgeDetails title="为什么这样判断？">{why}</WhyJudgeDetails>
    </article>
  );
}

function ObservationPoolIndexColumns() {
  const { indices } = useDataSource();
  const indexNameByCode = useMemo(
    () => new Map(indices.map((d) => [d.meta.index_code, d.meta.name])),
    [indices]
  );

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-3">
      {OBSERVATION_POOL_INDEX_COLUMNS.map((col) => (
        <div key={col.title} className="rounded-md border border-fin-border bg-fin-panel-muted px-3 py-4">
          <h4 className="text-center text-base font-semibold tracking-wide text-[var(--fin-text)]">{col.title}</h4>
          <ul className="mt-4 space-y-3">
            {col.indices.map((ix) => {
              const fullName = indexNameByCode.get(ix.code) ?? ix.name;
              return (
                <li key={ix.code} className="text-center">
                  <Link
                    to={`/indices/${encodeURIComponent(ix.code)}`}
                    className="inline-block text-sm font-medium leading-snug fin-link"
                  >
                    {fullName}
                  </Link>
                  <span className="mt-1 block font-mono text-[10px] fin-muted-text">{ix.code}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ConfigDeskOverview({ cashPerfLines, shareholderCard, etfPoolStats }: ConfigDeskOverviewProps) {
  const cashDim = CONFIG_DIMENSIONS.cash_creation;
  const divDim = CONFIG_DIMENSIONS.shareholder_return;
  const y5Line = cashPerfLines.find((l) => l.note?.includes("近5年")) ?? cashPerfLines.find((l) => l.summary.includes("年化"));
  const cashMetrics = parseCashY5(y5Line);
  const divYield = shareholderCard.stats.find((s) => s.label === "最新股息率");
  const spread = shareholderCard.stats.find((s) => s.label === "股债利差");
  const pct = shareholderCard.stats.find((s) => s.label === "利差历史分位");
  const shTone =
    shareholderCard.tone === "good" ? "good" : shareholderCard.tone === "warn" ? "warn" : "neutral";

  return (
    <section className="space-y-6">
      <p className="sr-only">指数负责研究判断，ETF 负责产品落地。</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <CockpitCard
          title={cashDim.title}
          status="质量底仓"
          statusTone="neutral"
          metrics={[
            { label: "近5年年化", value: cashMetrics.ann, mono: true },
            { label: "最大回撤", value: cashMetrics.dd, mono: true },
          ]}
          cta={{ label: "查看现金流指数", href: "/indices?dim=cash_creation" }}
          secondaryLinks={[
            { label: "产品选择", href: "/products" },
            { label: "中证全指", href: "/indices/932365" },
            { label: "国证", href: "/indices/980092" },
          ]}
          why={
            <>
              <p>{cashDim.frameworkBlurb}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {cashPerfLines.map((line) => (
                  <li key={line.indexCode}>
                    <Link to={`/indices/${encodeURIComponent(line.indexCode)}`} className="fin-link">
                      {line.displayName}
                    </Link>
                    <span className="fin-muted-text"> · {line.summary}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs fin-muted-text">
                观察池登记 {etfPoolStats.poolCount} 只产品；其中 {etfPoolStats.listedCount}{" "}
                只已上市可研究（与顶栏「可交易」口径一致）。
              </p>
            </>
          }
        />
        <CockpitCard
          title={divDim.title}
          status={shareholderCard.statusTitle}
          statusTone={shTone}
          metrics={[
            { label: "股息率", value: divYield?.value ?? "—", mono: true },
            { label: "股债利差", value: spread?.value ?? "—", mono: true },
            { label: "利差分位", value: pct?.value ?? "—", mono: true },
          ]}
          cta={{ label: "查看红利指数", href: "/indices?dim=shareholder_return" }}
          secondaryLinks={[
            { label: "产品选择", href: "/products" },
            { label: "中证红利", href: "/indices/000922" },
            { label: "中证红利低波", href: "/indices/H30269" },
          ]}
          why={
            <>
              <p>{shareholderCard.bullets[0] ?? shareholderCard.statusSubtitle}</p>
              {shareholderCard.highlightIndices.length > 0 ?
                <ul className="mt-2 space-y-1 text-sm">
                  {shareholderCard.highlightIndices.map((h) => (
                    <li key={h.code}>
                      <Link to={`/indices/${encodeURIComponent(h.code)}`} className="fin-link">
                        {h.name}
                      </Link>
                      <span className="fin-muted-text font-mono text-xs"> {h.code}</span>
                    </li>
                  ))}
                </ul>
              : null}
              <p className="mt-2 text-xs fin-muted-text">配置判断基于股息率与中国 10 年期国债利差，不构成投资建议。</p>
            </>
          }
        />
      </div>

      <section className="fin-panel p-4">
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"
          style={{ borderColor: "var(--fin-border)" }}
        >
          <h3 className="text-sm font-semibold text-[var(--fin-text)]">观察池指数</h3>
          <Link to="/products" className="text-xs fin-link">
            全部产品 →
          </Link>
        </div>
        <ObservationPoolIndexColumns />
      </section>
    </section>
  );
}
