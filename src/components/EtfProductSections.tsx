import { Link } from "react-router-dom";
import {
 ETF_PRODUCT_GROUP_LABELS,
 productDataStatusLabel,
 productDataStatusTone,
 type EtfProductGroupId,
 type EtfProductRecord,
} from "../lib/etfProducts";
import { ProductAumCell, ProductFeeCell } from "./ProductTableCells";

function statusBadgeClass(tone: ReturnType<typeof productDataStatusTone>) {
 if (tone === "good") return "border-emerald-200 bg-[var(--fin-up-soft)] text-fin-up";
 if (tone === "warn") return "border-amber-200 bg-[var(--fin-amber-soft)] text-fin-amber";
 return "border-fin-border bg-fin-panel-muted text-fin-muted";
}

export function ProductLandingGroup({
 groupId,
 products,
}: {
 groupId: EtfProductGroupId;
 products: EtfProductRecord[];
}) {
 const meta = ETF_PRODUCT_GROUP_LABELS[groupId];
 if (products.length === 0) {
 return (
 <p className="rounded border border-dashed border-fin-border px-3 py-2 font-mono text-xs text-fin-muted">
 {meta.emptyText}
 </p>
 );
 }

 return (
 <div className="space-y-2">
 <div className="flex items-baseline justify-between gap-2">
 <h3 className="fin-label text-fin-text">{meta.title}</h3>
 <span className="font-mono text-[10px] text-fin-muted">{products.length}</span>
 </div>
 <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
 {products.map((p) => {
 const tone = productDataStatusTone(p.dataStatus);
 return (
 <li
 key={p.code}
 className="fin-row-hover rounded border border-fin-border bg-fin-panel px-3 py-2 transition hover:border-fin-blue/30"
 >
 <div className="flex flex-wrap items-center gap-1.5">
 <Link
 to={`/etf/${encodeURIComponent(p.code)}`}
 className="font-mono text-sm font-semibold fin-link"
 title={p.isPrimary ? undefined : "参考产品，非盘中默认标的"}
 >
 {p.code}
 </Link>
 {p.isPrimary ?
 <span className="fin-chip border-fin-blue/30 bg-[var(--fin-blue-soft)] text-fin-blue">主跟踪</span>
 : (
 <span className="fin-chip border-fin-border bg-fin-panel-muted text-fin-muted">参考</span>
 )}
 <span className={`fin-chip ${statusBadgeClass(tone)}`}>{productDataStatusLabel(p.dataStatus)}</span>
 </div>
 <p className="mt-0.5 line-clamp-1 text-xs font-medium text-fin-text">{p.name}</p>
 <p className="mt-1 flex flex-wrap gap-x-2 font-mono text-[10px] text-fin-muted">
 {p.indexCode ?
 <Link to={`/indices/${encodeURIComponent(p.indexCode)}`} className="fin-link">
 {p.indexCode}
 </Link>
 : null}
 <span>{p.firstTradeDate ?? "—"}</span>
 </p>
 </li>
 );
 })}
 </ul>
 </div>
 );
}

export function IndexTrackingProductsTable({ products }: { products: EtfProductRecord[] }) {
 if (products.length === 0) {
 return <p className="mt-4 text-sm text-fin-muted">暂无跟踪产品</p>;
 }

 return (
 <div className="fin-panel mt-4 overflow-hidden">
 <table className="w-full min-w-[720px] text-sm">
 <thead>
 <tr className="fin-table-head">
 <th className="px-3 py-2 font-normal">产品</th>
 <th className="px-3 py-2 font-normal">角色</th>
 <th className="px-3 py-2 font-normal">规模</th>
 <th className="px-3 py-2 font-normal">费率</th>
 <th className="px-3 py-2 font-normal">首交易</th>
 <th className="px-3 py-2 font-normal">状态</th>
 <th className="px-3 py-2 font-normal">操作</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-fin-border">
 {products.map((p) => {
 const tone = productDataStatusTone(p.dataStatus);
 return (
 <tr key={p.code} className="fin-row-hover">
 <td className="px-3 py-2.5">
 <span className="font-mono font-semibold">{p.code}</span>
 <p className="mt-0.5 line-clamp-1 text-xs text-fin-muted">{p.name}</p>
 </td>
 <td className="px-3 py-2.5 text-xs">
 {p.isPrimary ?
 <span className="font-medium text-[var(--fin-blue)]">主</span>
 : (
 <span className="fin-muted-text">参考</span>
 )}
 </td>
 <td className="px-3 py-2.5">
 <ProductAumCell p={p} />
 </td>
 <td className="px-3 py-2.5">
 <ProductFeeCell p={p} />
 </td>
 <td className="px-3 py-2.5 font-mono text-xs">{p.firstTradeDate ?? "—"}</td>
 <td className="px-3 py-2.5">
 <span className={`fin-chip ${statusBadgeClass(tone)}`}>{productDataStatusLabel(p.dataStatus)}</span>
 </td>
 <td className="px-3 py-2.5 whitespace-nowrap text-xs">
 <Link to={`/etf/${encodeURIComponent(p.code)}`} className="fin-link">
 产品详情
 </Link>
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 );
}
