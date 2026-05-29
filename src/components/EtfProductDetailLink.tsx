import { Link } from "react-router-dom";
import {
  etfProductDetailNavigable,
  type EtfProductRecord,
} from "../lib/etfProducts";
import type { EtfDefinition } from "../types";

const DISABLED_TITLE = "暂无行情，产品详情不可用";

/** 禁用时不带 fin-link，避免蓝色覆盖灰色 */
const DISABLED_DETAIL_CLASS =
  "text-xs text-[var(--fin-dim)] cursor-not-allowed no-underline";

function withoutFinLink(classes: string): string {
  return classes
    .split(/\s+/)
    .filter((c) => c && c !== "fin-link")
    .join(" ");
}

export function EtfProductDetailLink({
  product,
  etf,
  className = "fin-link text-xs",
}: {
  product: Pick<EtfProductRecord, "code" | "dataStatus">;
  etf?: EtfDefinition | null;
  className?: string;
}) {
  if (!etfProductDetailNavigable(product, etf)) {
    return (
      <span
        className={DISABLED_DETAIL_CLASS}
        title={DISABLED_TITLE}
        aria-disabled="true"
      >
        产品详情
      </span>
    );
  }
  return (
    <Link to={`/etf/${encodeURIComponent(product.code)}`} className={className}>
      产品详情
    </Link>
  );
}

export function EtfProductCodeLink({
  product,
  etf,
  className = "font-mono text-sm font-semibold fin-link",
  title,
}: {
  product: Pick<EtfProductRecord, "code" | "dataStatus">;
  etf?: EtfDefinition | null;
  className?: string;
  title?: string;
}) {
  if (!etfProductDetailNavigable(product, etf)) {
    return (
      <span
        className={`${withoutFinLink(className)} text-[var(--fin-dim)] cursor-not-allowed no-underline`}
        title={title ?? DISABLED_TITLE}
        aria-disabled="true"
      >
        {product.code}
      </span>
    );
  }
  return (
    <Link
      to={`/etf/${encodeURIComponent(product.code)}`}
      className={className}
      title={title}
    >
      {product.code}
    </Link>
  );
}
