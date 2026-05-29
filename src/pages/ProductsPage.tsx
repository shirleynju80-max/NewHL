import { useDeferredValue, useMemo, useState } from "react";
import { useDataSource } from "../context/DataSourceContext";
import { PageHeader } from "../components/PageHeader";
import {
  FilterGroup,
  FilterSep,
} from "../components/FilterToolbar";
import {
  EtfProductsDataFootnote,
  EtfSelectionGuide,
  ProductsByIndexSections,
} from "../components/ProductsLandingTable";
import {
  filterProductIndexGroups,
  groupEtfProductsByIndex,
  limitIndexGroupCandidates,
  maxEtfProductsUpdatedAt,
  type ProductsDataStatusFilter,
  type ProductsDimensionFilter,
} from "../lib/etfProducts";

const DIMENSION_FILTERS: {
  id: ProductsDimensionFilter;
  label: string;
}[] = [
  { id: "all", label: "全部" },
  { id: "cash_creation", label: "现金创造" },
  { id: "shareholder_return_cn", label: "A股红利" },
  { id: "shareholder_return_hk", label: "港股红利" },
];

const DATA_FILTERS: { id: ProductsDataStatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "ok", label: "行情已接入" },
  { id: "pending", label: "暂无" },
];

export function ProductsPage() {
  const { etfProducts, dividendRepresentativePool } = useDataSource();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [dimension, setDimension] = useState<ProductsDimensionFilter>("all");
  const [dataStatus, setDataStatus] = useState<ProductsDataStatusFilter>("all");
  const [primaryOnly, setPrimaryOnly] = useState(false);

  const indexGroups = useMemo(
    () => groupEtfProductsByIndex(etfProducts),
    [etfProducts],
  );

  const filteredGroups = useMemo(
    () =>
      filterProductIndexGroups(indexGroups, {
        query: deferredQuery,
        dimension,
        dataStatus,
        primaryOnly,
        representativeByIndex: dividendRepresentativePool?.byIndex,
      }),
    [
      indexGroups,
      deferredQuery,
      dimension,
      dataStatus,
      primaryOnly,
      dividendRepresentativePool?.byIndex,
    ],
  );

  const poolStats = useMemo(() => {
    const primary = etfProducts.filter((p) => p.isPrimary).length;
    const candidateSlots = indexGroups.reduce(
      (n, g) => n + limitIndexGroupCandidates(g.products).length,
      0,
    );
    return {
      indices: indexGroups.length,
      candidates: candidateSlots,
      primary,
      dataUpdatedAt: maxEtfProductsUpdatedAt(etfProducts),
    };
  }, [etfProducts, indexGroups]);

  const filterResultCount = useMemo(() => {
    const etfs = filteredGroups.reduce((n, g) => n + g.products.length, 0);
    return { indices: filteredGroups.length, etfs };
  }, [filteredGroups]);

  const hasActiveFilters =
    deferredQuery.trim() !== "" ||
    dimension !== "all" ||
    dataStatus !== "all" ||
    primaryOnly;

  return (
    <div className="ft-page space-y-6">
      <PageHeader
        kicker="执行层"
        title="产品选择"
        breadcrumbs={[{ label: "配置总览", to: "/" }, { label: "产品选择" }]}
        description="先选定指数逻辑，再在同指数 ETF 中比较规模、费率、成立时间与数据状态。"
      >
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="fin-label">覆盖指数</dt>
            <dd className="font-mono font-semibold text-[var(--fin-text)]">
              {poolStats.indices} 个
            </dd>
          </div>
          <div>
            <dt className="fin-label">ETF 候选</dt>
            <dd className="font-mono font-semibold text-[var(--fin-text)]">
              {poolStats.candidates} 只
            </dd>
          </div>
          <div>
            <dt className="fin-label">主跟踪</dt>
            <dd className="font-mono font-semibold text-[var(--fin-text)]">
              {poolStats.primary} 只
            </dd>
          </div>
          <div>
            <dt className="fin-label">规模/费率更新</dt>
            <dd className="font-mono text-xs font-semibold text-[var(--fin-text)]">
              {poolStats.dataUpdatedAt ?? "—"}
            </dd>
          </div>
        </dl>
      </PageHeader>

      <section className="fin-panel space-y-2 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[min(100%,220px)] flex-1 text-sm">
            <span className="fin-label">搜索</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="指数或 ETF 代码、名称"
              className="fin-select fin-interactive mt-1 block w-full rounded-md border border-fin-border bg-transparent px-3 py-2 text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {hasActiveFilters ? (
            <button
              type="button"
              className="fin-chip-filter indices-filter-chip px-2 py-1.5 text-xs"
              onClick={() => {
                setQuery("");
                setDimension("all");
                setDataStatus("all");
                setPrimaryOnly(false);
              }}
            >
              重置筛选
            </button>
          ) : null}
        </div>

        <div className="indices-filter-bar flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-fin-border pt-2">
          <FilterGroup label="维度">
            {DIMENSION_FILTERS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDimension(d.id)}
                className={`fin-chip-filter indices-filter-chip ${dimension === d.id ? "fin-chip-filter-active" : ""}`}
              >
                {d.label}
              </button>
            ))}
          </FilterGroup>
          <FilterSep />
          <FilterGroup label="数据">
            {DATA_FILTERS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDataStatus(d.id)}
                className={`fin-chip-filter indices-filter-chip ${dataStatus === d.id ? "fin-chip-filter-active" : ""}`}
              >
                {d.label}
              </button>
            ))}
          </FilterGroup>
          <FilterSep />
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 px-1 text-[11px] fin-muted-text">
            <input
              type="checkbox"
              checked={primaryOnly}
              onChange={(e) => setPrimaryOnly(e.target.checked)}
              className="rounded border-fin-border"
            />
            仅看主产品
          </label>
        </div>

        {hasActiveFilters ? (
          <p className="text-xs fin-muted-text">
            当前 {filterResultCount.indices} 个指数 · {filterResultCount.etfs}{" "}
            只候选 ETF
          </p>
        ) : null}
      </section>

      <ProductsByIndexSections
        groups={filteredGroups}
        emptyMessage="暂无符合筛选条件的指数候选，请调整搜索或筛选条件。"
      />

      <footer className="space-y-4 border-t border-fin-border pt-6">
        <EtfSelectionGuide />
        <EtfProductsDataFootnote dataUpdatedAt={poolStats.dataUpdatedAt} />
      </footer>
    </div>
  );
}
