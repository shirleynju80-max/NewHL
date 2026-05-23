import { Link } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import type { EtfDefinition } from "../types";
import {
 ETF_PRODUCT_GROUP_LABELS,
 productDataStatusHint,
 productDataStatusTone,
 type EtfProductsByIndexGroup,
 type EtfProductRecord,
} from "../lib/etfProducts";
import { etfListingStartDate, isEtfProductListed } from "../lib/etfListingAge";
import { ProductAumCell, ProductCandidateTags, ProductFeeCell } from "./ProductTableCells";

function statusClass(tone: ReturnType<typeof productDataStatusTone>) {
 if (tone === "good") return "fin-status-good";
 if (tone === "warn") return "fin-status-warn";
 return "fin-status-neutral";
}

function ProductDetailLink({ code }: { code: string }) {
  return (
    <Link to={`/etf/${encodeURIComponent(code)}`} className="fin-link text-xs">
      产品详情
    </Link>
  );
}

export function filterListedEtfProducts(
 products: EtfProductRecord[],
 getEtf: (code: string) => EtfDefinition | undefined
): EtfProductRecord[] {
 return products.filter((p) => isEtfProductListed(getEtf(p.code), p));
}

export function EtfSelectionGuide() {
 return (
 <aside className="fin-panel space-y-4 p-5 text-sm fin-muted-text">
 <h2 className="text-base font-semibold text-[var(--fin-text)]">选择 ETF，重点看</h2>
 <ol className="space-y-3 list-decimal pl-4">
 <li>
 <strong>规模</strong> — 过小可能流动性不足、清盘或跟踪不稳；同类中规模更大者更适合长期底仓候选。
 </li>
 <li>
 <strong>费率</strong> — 管理费与托管费长期侵蚀收益；跟踪同一指数时，费率更低持有成本更低。
 </li>
 <li>
 <strong>跟踪误差</strong> — 反映 ETF 是否有效跟上指数；误差更低更接近指数表现。
 </li>
 <li>
 <strong>流动性</strong> — 看成交额、买卖价差与折溢价；流动性差盘中成本可能更高。
 </li>
 </ol>
 <p className="text-xs fin-muted-text border-t border-fin-border pt-3">
 规模、费率来自基金公告月更；成交额、折溢价、跟踪误差待补。同类产品请优先看规模与费率，勿按短期收益排序。
 </p>
 </aside>
 );
}

function IndexProductsMobileList({ products }: { products: EtfProductRecord[] }) {
 const { getEtf } = useDataSource();

 return (
 <ul className="divide-y divide-fin-border md:hidden">
 {products.map((p) => {
 const etf = getEtf(p.code);
 const tone = productDataStatusTone(p.dataStatus);
 const firstTrade = etf ? etfListingStartDate(etf, p) : p.firstTradeDate;
 return (
 <li key={p.code} className="space-y-2 p-3">
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <p className="font-mono text-sm font-semibold">{p.code}</p>
 <p className="line-clamp-2 text-xs fin-muted-text">{p.name}</p>
 </div>
 <span className={statusClass(tone)}>{productDataStatusHint(p.dataStatus)}</span>
 </div>
 <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
 <div>
 <dt className="fin-label">角色</dt>
 <dd className={p.isPrimary ? "font-medium text-[var(--fin-blue)]" : "fin-muted-text"}>
 {p.isPrimary ? "主跟踪" : "参考"}
 </dd>
 </div>
 <div>
 <dt className="fin-label">首交易日</dt>
 <dd className="font-mono">{firstTrade ?? "—"}</dd>
 </div>
 <div>
 <dt className="fin-label">规模</dt>
 <dd>
 <ProductAumCell p={p} />
 </dd>
 </div>
 <div>
 <dt className="fin-label">综合费率</dt>
 <dd>
 <ProductFeeCell p={p} />
 </dd>
 </div>
 </dl>
 <ProductCandidateTags p={p} />
 <ProductDetailLink code={p.code} />
 </li>
 );
 })}
 </ul>
 );
}

function IndexProductsTable({ products }: { products: EtfProductRecord[] }) {
 const { getEtf } = useDataSource();

 return (
 <>
 <IndexProductsMobileList products={products} />
 <div className="hidden overflow-x-auto md:block">
 <table className="w-full min-w-[880px] text-sm">
 <thead>
 <tr className="fin-table-head">
 <th className="px-3 py-2 font-normal">产品</th>
 <th className="px-3 py-2 font-normal">角色</th>
 <th className="px-3 py-2 font-normal">规模</th>
 <th className="px-3 py-2 font-normal">综合费率</th>
 <th className="px-3 py-2 font-normal">首交易日</th>
 <th className="px-3 py-2 font-normal">候选维度</th>
 <th className="px-3 py-2 font-normal" title="行情与属性同步情况">
 数据
 </th>
 <th className="px-3 py-2 font-normal">操作</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-fin-border">
 {products.map((p) => {
 const etf = getEtf(p.code);
 const tone = productDataStatusTone(p.dataStatus);
 const firstTrade = etf ? etfListingStartDate(etf, p) : p.firstTradeDate;
 return (
 <tr key={p.code} className="fin-row-hover">
 <td className="px-3 py-2.5">
 <span className="font-mono font-semibold">{p.code}</span>
 <p className="mt-0.5 line-clamp-1 text-xs fin-muted-text">{p.name}</p>
 </td>
 <td className="px-3 py-2.5 text-xs">
 {p.isPrimary ?
 <span className="font-medium text-[var(--fin-blue)]">主跟踪</span>
 : <span className="fin-muted-text">参考</span>}
 </td>
 <td className="px-3 py-2.5">
 <ProductAumCell p={p} />
 </td>
 <td className="px-3 py-2.5">
 <ProductFeeCell p={p} />
 </td>
 <td className="px-3 py-2.5 font-mono text-xs">{firstTrade ?? "—"}</td>
 <td className="px-3 py-2.5 max-w-[10rem]">
 <ProductCandidateTags p={p} />
 </td>
 <td className="px-3 py-2.5">
 <span className={statusClass(tone)}>{productDataStatusHint(p.dataStatus)}</span>
 </td>
 <td className="px-3 py-2.5">
 <ProductDetailLink code={p.code} />
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </>
 );
}

export function ProductsByIndexSections({ groups }: { groups: EtfProductsByIndexGroup[] }) {
 if (groups.length === 0) {
 return (
 <p className="text-sm fin-muted-text fin-panel p-6">暂无已上市交易的观察池产品。待发行条目已从本页隐藏。</p>
 );
 }

 let lastGroup: string | null = null;

 return (
 <div className="space-y-8">
 {groups.map((group) => {
 const showGroupHeading = group.productGroup !== lastGroup;
 lastGroup = group.productGroup;
 const dimLabel = ETF_PRODUCT_GROUP_LABELS[group.productGroup]?.title ?? group.productGroup;
 return (
 <section key={group.indexCode} className="space-y-3">
 {showGroupHeading ?
 <p className="text-xs font-medium uppercase tracking-wide fin-muted-text">{dimLabel}</p>
 : null}
 <div className="flex flex-wrap items-baseline justify-between gap-2">
 <h3 className="text-base font-semibold text-[var(--fin-text)]">
 <Link to={`/indices/${encodeURIComponent(group.indexCode)}`} className="hover:text-[var(--fin-blue)]">
 {group.indexName}
 </Link>
 <span className="ml-2 font-mono text-sm font-normal fin-muted-text">{group.indexCode}</span>
 </h3>
 <span className="text-xs fin-muted-text">
 {group.products.length} 只 ETF
 {group.products.some((p) => p.isPrimary) ?
 <span className="text-[var(--fin-blue)]"> · 含主跟踪</span>
 : null}
 </span>
 </div>
 <div className="fin-panel">
 <IndexProductsTable products={group.products} />
 </div>
 </section>
 );
 })}
 </div>
 );
}

export function EtfProductsDataFootnote({
 poolTotal,
 listedCount,
 dataUpdatedAt,
}: {
 poolTotal: number;
 listedCount: number;
 dataUpdatedAt: string | null;
}) {
 const hidden = Math.max(0, poolTotal - listedCount);
 return (
 <p className="text-xs leading-relaxed fin-muted-text">
 ETF 产品数据更新至 {dataUpdatedAt ?? "—"}（规模、费率、候选维度等字段）。
 {hidden > 0 ?
 ` 观察池共登记 ${poolTotal} 只，本页展示已成立并上市 ${listedCount} 只；另有 ${hidden} 只暂未发行或无本地行情，未列入。`
 : ` 本页展示 ${listedCount} 只。`}
 首交易日优先取 <code className="rounded bg-fin-panel-muted px-1">etf_products.csv</code>，缺失时回退本地日 K 首根 bar。
 </p>
 );
}
