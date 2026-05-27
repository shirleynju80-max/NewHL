import { Link } from "react-router-dom";
import { useStrategyRegistry } from "../context/StrategyRegistryContext";
import {
  getProductParamVariants,
  type ParamVariantProductMeta,
} from "../lib/paramVariants";
import {
  isUserRegisteredVariantKey,
  variantMonitorCompact,
} from "../lib/strategyLabels";
import type { EtfDefinition } from "../types";

type EtfRegisteredParamsListProps = {
  etf: EtfDefinition;
  product?: ParamVariantProductMeta | null;
  /** 是否包含策略研究「观测注册」项 */
  includeRegistry?: boolean;
  compact?: boolean;
  className?: string;
  linkToMonitor?: boolean;
};

export function EtfRegisteredParamsList({
  etf,
  product,
  includeRegistry = true,
  compact = false,
  className = "",
  linkToMonitor = false,
}: EtfRegisteredParamsListProps) {
  const { entries } = useStrategyRegistry();
  const variants = includeRegistry
    ? getProductParamVariants(etf, product, entries)
    : getProductParamVariants(etf, product, []).filter(
        (v) => !isUserRegisteredVariantKey(v.key),
      );

  if (!variants.length) {
    return (
      <p className={`text-xs fin-muted-text ${className}`.trim()}>
        暂无登记策略参数
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--fin-dim)]">
          已登记参数
        </span>
        {linkToMonitor ? (
          <Link
            to={`/monitor`}
            className="text-[10px] fin-link"
            title="在盘中监控查看全部策略标尺"
          >
            盘中监控 →
          </Link>
        ) : (
          <Link
            to={`/etf/${encodeURIComponent(etf.meta.code)}?tab=intraday`}
            className="text-[10px] fin-link"
          >
            盘中信号 →
          </Link>
        )}
      </div>
      <ul
        className={`mt-1.5 flex flex-wrap gap-1.5 ${compact ? "" : "mt-2"}`}
      >
        {variants.map((v) => {
          const reg = isUserRegisteredVariantKey(v.key);
          const label = variantMonitorCompact(v);
          return (
            <li key={v.key}>
              <span
                title={`${label} · ${v.paramVersion}`}
                className={`inline-block max-w-[14rem] truncate rounded border px-2 py-0.5 font-mono text-[10px] ${
                  reg
                    ? "border-[rgba(148,163,184,0.2)] bg-fin-panel-muted text-[var(--fin-muted)]"
                    : "border-[rgba(79,125,243,0.28)] bg-[var(--fin-blue-soft)] text-[var(--fin-text)]"
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
