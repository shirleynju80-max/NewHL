import { Link } from "react-router-dom";
import { EtfProductDetailLink } from "./EtfProductDetailLink";
import { useDataSource } from "../context/DataSourceContext";
import {
  ETF_PRODUCT_GROUP_LABELS,
  productCandidateTags,
  productSelectionDataStatusHint,
  productSelectionDataStatusTone,
  type EtfProductsByIndexGroup,
  type EtfProductRecord,
} from "../lib/etfProducts";
import { etfListingStartDate } from "../lib/etfListingAge";
import {
  isQuantRepresentative,
  type DividendRepresentativePool,
} from "../lib/dividendRepresentativePool";
import { ProductAumCell, ProductFeeCell } from "./ProductTableCells";

function statusClass(tone: ReturnType<typeof productSelectionDataStatusTone>) {
  if (tone === "good") return "fin-status-good products-status-ok";
  if (tone === "warn") return "fin-status-warn";
  return "fin-status-neutral";
}

function dimensionChipLabel(group: EtfProductsByIndexGroup): string {
  return (
    ETF_PRODUCT_GROUP_LABELS[group.productGroup]?.title ?? group.productGroup
  );
}

export function EtfSelectionGuide() {
  return (
    <section className="fin-panel space-y-3 p-5 text-sm fin-muted-text">
      <h2 className="text-base font-semibold text-[var(--fin-text)]">
        选择 ETF 看什么
      </h2>
      <ul className="grid gap-2 text-xs leading-relaxed sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <strong className="text-[var(--fin-text)]">规模</strong> —
          过小需关注清盘与流动性。
        </li>
        <li>
          <strong className="text-[var(--fin-text)]">费率</strong> —
          同指数下比综合费率。
        </li>
        <li>
          <strong className="text-[var(--fin-text)]">成立时间</strong> —
          首交易日越早，历史样本通常越长。
        </li>
        <li>
          <strong className="text-[var(--fin-text)]">流动性</strong> —
          暂未接入。
        </li>
        <li>
          <strong className="text-[var(--fin-text)]">折溢价</strong> —
          暂未接入。
        </li>
        <li>
          <strong className="text-[var(--fin-text)]">跟踪误差</strong> —
          暂未接入。
        </li>
      </ul>
    </section>
  );
}

function CandidateReasonTags({
  p,
  dividendPool,
}: {
  p: EtfProductRecord;
  dividendPool?: DividendRepresentativePool | null;
}) {
  const tags = [...productCandidateTags(p.note)];
  if (p.isPrimary && !tags.includes("主产品")) {
    tags.unshift("主产品");
  }
  if (
    isQuantRepresentative(dividendPool, p.code) &&
    !tags.includes("量化代表")
  ) {
    tags.push("量化代表");
  }
  if (tags.length === 0) {
    return <span className="text-xs text-[var(--fin-dim)]">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={
            tag === "主产品"
              ? "products-tag products-tag-primary"
              : "products-tag"
          }
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function IndexCandidateMobileCards({
  products,
  dividendPool,
}: {
  products: EtfProductRecord[];
  dividendPool?: DividendRepresentativePool | null;
}) {
  const { getEtf } = useDataSource();

  return (
    <ul className="divide-y divide-fin-border md:hidden">
      {products.map((p) => {
        const etf = getEtf(p.code);
        const tone = productSelectionDataStatusTone(p.dataStatus);
        const firstTrade = etf ? etfListingStartDate(etf, p) : p.firstTradeDate;
        return (
          <li key={p.code} className="space-y-2 px-3 py-3">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-[var(--fin-text)]">
                {p.code}
              </p>
              <p className="line-clamp-2 text-xs fin-muted-text">{p.name}</p>
            </div>
            <CandidateReasonTags p={p} dividendPool={dividendPool} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
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
              <div>
                <dt className="fin-label">首交易日</dt>
                <dd className="font-mono">{firstTrade ?? "—"}</dd>
              </div>
              <div>
                <dt className="fin-label">数据状态</dt>
                <dd>
                  <span className={statusClass(tone)}>
                    {productSelectionDataStatusHint(p.dataStatus)}
                  </span>
                </dd>
              </div>
            </dl>
            <EtfProductDetailLink product={p} etf={etf} />
          </li>
        );
      })}
    </ul>
  );
}

function IndexCandidateCompareTable({
  products,
  dividendPool,
}: {
  products: EtfProductRecord[];
  dividendPool?: DividendRepresentativePool | null;
}) {
  const { getEtf } = useDataSource();

  return (
    <table className="products-compare-table hidden w-full text-xs md:table">
      <thead>
        <tr className="fin-table-head">
          <th className="px-3 py-2 text-left font-normal">产品</th>
          <th className="px-3 py-2 text-left font-normal">候选理由</th>
          <th className="px-3 py-2 text-right font-normal">规模</th>
          <th className="px-3 py-2 text-right font-normal">综合费率</th>
          <th className="px-3 py-2 text-left font-normal">首交易日</th>
          <th className="px-3 py-2 text-left font-normal">数据状态</th>
          <th className="px-3 py-2 text-left font-normal">操作</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-fin-border">
        {products.map((p) => {
          const etf = getEtf(p.code);
          const tone = productSelectionDataStatusTone(p.dataStatus);
          const firstTrade = etf
            ? etfListingStartDate(etf, p)
            : p.firstTradeDate;
          return (
            <tr key={p.code} className="fin-row-hover">
              <td className="px-3 py-2 align-top">
                <span className="font-mono text-sm font-semibold">
                  {p.code}
                </span>
                <p className="mt-0.5 line-clamp-1 fin-muted-text">{p.name}</p>
              </td>
              <td className="px-3 py-2 align-top">
                <CandidateReasonTags p={p} dividendPool={dividendPool} />
              </td>
              <td className="px-3 py-2 text-right align-top">
                <ProductAumCell p={p} />
              </td>
              <td className="px-3 py-2 text-right align-top">
                <ProductFeeCell p={p} />
              </td>
              <td className="px-3 py-2 font-mono align-top">
                {firstTrade ?? "—"}
              </td>
              <td className="px-3 py-2 align-top">
                <span className={statusClass(tone)}>
                  {productSelectionDataStatusHint(p.dataStatus)}
                </span>
              </td>
              <td className="px-3 py-2 align-top whitespace-nowrap">
                <EtfProductDetailLink product={p} etf={etf} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function IndexCandidatePanel({ group }: { group: EtfProductsByIndexGroup }) {
  const { dividendRepresentativePool } = useDataSource();
  const primary = group.products.find((p) => p.isPrimary);
  return (
    <article className="products-index-panel fin-panel overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-fin-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--fin-text)]">
              {group.indexName}
            </h3>
            <span className="products-tag">{dimensionChipLabel(group)}</span>
          </div>
          <p className="mt-1 font-mono text-xs fin-muted-text">
            {group.indexCode}
          </p>
          <p className="mt-1.5 text-xs fin-muted-text">
            {group.products.length} 只候选 ETF
            {primary ? (
              <span className="text-[var(--fin-blue)]">
                {" "}
                · 主跟踪 {primary.code}
              </span>
            ) : null}
          </p>
        </div>
        <Link
          to={`/indices/${encodeURIComponent(group.indexCode)}`}
          className="fin-link shrink-0 text-xs"
        >
          指数详情
        </Link>
      </header>
      <IndexCandidateMobileCards
        products={group.products}
        dividendPool={dividendRepresentativePool}
      />
      <IndexCandidateCompareTable
        products={group.products}
        dividendPool={dividendRepresentativePool}
      />
    </article>
  );
}

export function ProductsByIndexSections({
  groups,
  emptyMessage,
}: {
  groups: EtfProductsByIndexGroup[];
  emptyMessage?: string;
}) {
  if (groups.length === 0) {
    return (
      <p className="fin-panel p-6 text-sm fin-muted-text">
        {emptyMessage ?? "暂无符合筛选条件的指数候选。"}
      </p>
    );
  }

  return (
    <div className="products-index-list space-y-4">
      {groups.map((group) => (
        <IndexCandidatePanel key={group.indexCode} group={group} />
      ))}
    </div>
  );
}

export function EtfProductsDataFootnote({
  dataUpdatedAt,
}: {
  poolTotal?: number;
  listedCount?: number;
  dataUpdatedAt: string | null;
}) {
  return (
    <p className="text-xs leading-relaxed fin-muted-text">
      规模、综合费率更新至 {dataUpdatedAt ?? "—"}
      。候选理由来自产品备注；首交易日以产品登记为准，缺失时用本地行情首日。
    </p>
  );
}
