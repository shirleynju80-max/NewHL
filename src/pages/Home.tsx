import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { ConfigDeskOverview } from "../components/ConfigDeskOverview";
import { ConfigJourney } from "../components/ConfigJourney";
import { isEtfProductListed } from "../lib/etfListingAge";
import { buildCashCreationPerformanceLines, buildHomeDimensionSnapshots } from "../lib/configFramework";
export function HomePage() {
 const { definitions, indices, bondByDate, indexTracking, etfProducts } = useDataSource();

 const defByCode = useMemo(() => new Map(definitions.map((d) => [d.meta.code, d])), [definitions]);

 const etfPoolStats = useMemo(() => {
 const listed = etfProducts.filter((p) => isEtfProductListed(defByCode.get(p.code), p));
 return {
 primaryCount: etfProducts.filter((p) => p.isPrimary).length,
 listedCount: listed.length,
 poolCount: etfProducts.length,
 };
 }, [etfProducts, defByCode]);

 const dimensionSnapshots = useMemo(
 () => buildHomeDimensionSnapshots({ indices, bondByDate, indexTracking }),
 [indices, bondByDate, indexTracking]
 );
 const cashPerfLines = useMemo(() => buildCashCreationPerformanceLines(indices), [indices]);
 return (
 <div className="space-y-8">
      <header className="fin-page-header border-0 pb-0">
        <p className="fin-kicker">配置层</p>
        <h2 className="fin-page-title mt-1">配置总览</h2>
 <p className="fin-body mt-2 max-w-2xl">
 从<strong className="font-medium text-[var(--fin-text)]">现金创造</strong>与
 <strong className="font-medium text-[var(--fin-text)]">股东回报</strong>
 两个维度构建长期底仓；指数负责研究，ETF 负责落地。
 </p>
 </header>

 <ConfigJourney />

 <ConfigDeskOverview
 cashPerfLines={cashPerfLines}
 shareholderCard={dimensionSnapshots.shareholder_return}
 etfPoolStats={etfPoolStats}
 />

 <section className="fin-panel border-dashed p-5">
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div>
 <p className="fin-label uppercase tracking-wide">策略层（可选）</p>
 <h3 className="mt-1 text-base font-semibold text-[var(--fin-text)]">在底仓之上做规则与执行</h3>
 <p className="fin-body mt-2 max-w-xl">
 配置定「配什么」；ETF 对比、盘中监控与策略研究工具用于验证规则、观察执行节奏，不构成买卖建议。
 </p>
 </div>
 <div className="flex flex-wrap gap-2 text-sm">
 <Link to="/compare" className="fin-btn-secondary">
 ETF对比工具
 </Link>
 <Link to="/monitor" className="fin-btn-secondary">
 盘中监控
 </Link>
 <Link to="/registry" className="fin-btn-secondary">
 策略研究工具
 </Link>
 </div>
 </div>
 </section>
 </div>
 );
}
