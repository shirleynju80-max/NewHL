import { useMemo } from "react";
import { useDataSource } from "../context/DataSourceContext";
import { PageHeader } from "../components/PageHeader";
import {
  EtfProductsDataFootnote,
  EtfSelectionGuide,
  filterListedEtfProducts,
  ProductsByIndexSections,
} from "../components/ProductsLandingTable";
import { groupEtfProductsByIndex, maxEtfProductsUpdatedAt } from "../lib/etfProducts";

export function ProductsPage() {
  const { etfProducts, getEtf } = useDataSource();

  const listedProducts = useMemo(
    () => filterListedEtfProducts(etfProducts, getEtf),
    [etfProducts, getEtf]
  );

  const indexGroups = useMemo(() => groupEtfProductsByIndex(listedProducts), [listedProducts]);

  const poolStats = useMemo(() => {
    const primary = listedProducts.filter((p) => p.isPrimary).length;
    return {
      poolTotal: etfProducts.length,
      listed: listedProducts.length,
      primary,
      reference: listedProducts.length - primary,
      indices: indexGroups.length,
      dataUpdatedAt: maxEtfProductsUpdatedAt(etfProducts),
    };
  }, [etfProducts, listedProducts, indexGroups.length]);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="执行层"
        title="产品选择"
        breadcrumbs={[
          { label: "配置总览", to: "/" },
          { label: "产品选择" },
        ]}
        description={
          <>
            按<strong>跟踪指数</strong>列出已上市交易的 ETF（主跟踪 + 同指数参考）。暂未成立或尚无本地行情的产品不在此页展示；选择时优先看规模与综合费率。
          </>
        }
      >
        <dl className="mt-4 flex flex-wrap gap-6 text-sm">
          <div>
            <dt className="fin-label">本页产品</dt>
            <dd className="font-mono font-semibold text-[var(--fin-text)]">{poolStats.listed} 只</dd>
          </div>
          <div>
            <dt className="fin-label">覆盖指数</dt>
            <dd className="font-mono font-semibold text-[var(--fin-text)]">{poolStats.indices} 个</dd>
          </div>
          <div>
            <dt className="fin-label">主跟踪</dt>
            <dd className="font-mono font-semibold text-[var(--fin-blue)]">{poolStats.primary} 只</dd>
          </div>
          <div>
            <dt className="fin-label">参考产品</dt>
            <dd className="font-mono font-semibold fin-muted-text">{poolStats.reference} 只</dd>
          </div>
        </dl>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(240px,300px)]">
        <ProductsByIndexSections groups={indexGroups} />
        <EtfSelectionGuide />
      </div>

      <footer className="border-t border-fin-border pt-4">
        <EtfProductsDataFootnote
          poolTotal={poolStats.poolTotal}
          listedCount={poolStats.listed}
          dataUpdatedAt={poolStats.dataUpdatedAt}
        />
      </footer>
    </div>
  );
}
