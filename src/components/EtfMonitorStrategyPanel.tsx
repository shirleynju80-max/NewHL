import type { ParamStrategyVariant } from "../types";
import {
  getHiddenMonitorKeys,
  hideMonitorStrategy,
  restoreBuiltinMonitorVisibility,
} from "../lib/etfMonitorStrategyPref";
import {
  isUserRegisteredVariantKey,
  variantMonitorCompact,
} from "../lib/strategyLabels";

type Props = {
  etfCode: string;
  allVariants: ParamStrategyVariant[];
  builtinVariants: ParamStrategyVariant[];
  visibleVariants: ParamStrategyVariant[];
  activeKey?: string;
  onPrefChange: () => void;
  onRemoveRegistered?: (registryId: string) => void;
  onActiveKeyChange?: (key: string) => void;
};

export function EtfMonitorStrategyPanel({
  etfCode,
  allVariants,
  builtinVariants,
  visibleVariants,
  activeKey,
  onPrefChange,
  onRemoveRegistered,
  onActiveKeyChange,
}: Props) {
  const hiddenCount = getHiddenMonitorKeys(etfCode).size;

  function afterChange(nextVisible: ParamStrategyVariant[]) {
    onPrefChange();
    if (activeKey && !nextVisible.some((v) => v.key === activeKey)) {
      onActiveKeyChange?.(nextVisible[0]?.key ?? "");
    }
  }

  function handleRemove(v: ParamStrategyVariant) {
    hideMonitorStrategy(etfCode, v.key);
    if (isUserRegisteredVariantKey(v.key) && onRemoveRegistered) {
      onRemoveRegistered(v.key.slice("reg:".length));
    }
    const next = visibleVariants.filter((x) => x.key !== v.key);
    afterChange(next);
  }

  function handleRestoreDefaults() {
    restoreBuiltinMonitorVisibility(etfCode, allVariants, builtinVariants);
    afterChange(builtinVariants);
  }

  if (!allVariants.length) return null;

  return (
    <div className="fin-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fin-text)]">
            当前监控策略
          </h3>
          <p className="mt-1 text-xs fin-muted-text">
            控制本页回测、图表与右侧买卖区间列表；删除后不再展示。恢复默认仅保留
            <span className="text-[var(--fin-text)]"> 系统内置 </span>
            策略（{builtinVariants.length} 套），观测注册项将移出列表。
          </p>
        </div>
        <button
          type="button"
          className="fin-chip-filter text-xs"
          onClick={handleRestoreDefaults}
          disabled={!builtinVariants.length}
        >
          恢复默认
        </button>
      </div>

      {visibleVariants.length === 0 ? (
        <p className="mt-3 text-xs fin-muted-text">
          暂无监控策略。
          {builtinVariants.length > 0 ? (
            <button
              type="button"
              className="ml-1 fin-link"
              onClick={handleRestoreDefaults}
            >
              恢复默认
            </button>
          ) : null}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {visibleVariants.map((v) => {
            const builtin = builtinVariants.some((b) => b.key === v.key);
            return (
              <li
                key={v.key}
                className={`flex items-start justify-between gap-3 rounded-lg border border-fin-border bg-fin-panel-muted/70 px-3 py-2 ${
                  v.key === activeKey ? "ring-1 ring-[var(--fin-blue)]/50" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-medium leading-snug text-[var(--fin-text)]">
                    {variantMonitorCompact(v)}
                  </p>
                  <p className="mt-0.5 text-[10px] fin-muted-text">
                    {builtin ? (
                      <span className="text-[var(--fin-blue)]">内置</span>
                    ) : (
                      <span className="text-[var(--fin-amber)]">观测注册</span>
                    )}
                    {v.key === activeKey ? (
                      <span className="text-[var(--fin-dim)]"> · 当前回测</span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-[var(--fin-red)] hover:underline"
                  onClick={() => handleRemove(v)}
                >
                  删除
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 ? (
        <p className="mt-2 text-[10px] fin-muted-text">
          已隐藏 {hiddenCount} 套策略（恢复默认可重新显示内置项）。
        </p>
      ) : null}

      {builtinVariants.length > 0 ? (
        <details className="mt-3 border-t border-fin-border pt-2">
          <summary className="cursor-pointer text-[10px] fin-muted-text">
            系统内置默认策略（{etfCode}，共 {builtinVariants.length} 套）
          </summary>
          <ul className="mt-2 space-y-1 text-[10px] fin-muted-text">
            {builtinVariants.map((v) => (
              <li key={v.key} className="font-mono leading-snug">
                {variantMonitorCompact(v)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
