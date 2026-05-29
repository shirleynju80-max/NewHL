import { useEffect, useState } from "react";
import type { EtfParams } from "../types";
import type { CustomBaselineKind, ScoredParamRow } from "../lib/paramBacktest";
import { formatPct, formatSignedPct } from "../lib/formatDisplay";

export type { CustomBaselineKind } from "../lib/paramBacktest";

export const MAX_CUSTOM_BASELINES = 3;

export type CustomBaselineFormValues = {
  rsiMode: "1d" | "1w";
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  bollMode: "1d" | "1w";
  bollPeriod: number;
  bollStd: number;
  maFast: number;
  maSlow: number;
};

export const CUSTOM_BASELINE_KIND_OPTIONS: {
  id: CustomBaselineKind;
  label: string;
}[] = [
  { id: "rsi", label: "RSI" },
  { id: "boll", label: "布林带" },
  { id: "ma", label: "MA" },
];

export function defaultCustomBaselineForm(): CustomBaselineFormValues {
  return {
    rsiMode: "1d",
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    bollMode: "1d",
    bollPeriod: 20,
    bollStd: 2,
    maFast: 10,
    maSlow: 60,
  };
}

export function kindFromStrategyId(strategyId: string): CustomBaselineKind {
  const s = strategyId.toLowerCase();
  if (s.includes("rsi")) return "rsi";
  if (s.includes("boll")) return "boll";
  return "ma";
}

export type CommittedCustomBaseline = {
  kind: CustomBaselineKind;
  strategyId: string;
  params: EtfParams;
  /** RSI / 布林：使用日线或周线信号（默认日线） */
  mode?: "1d" | "1w";
};

export type CustomBaselineSlot = {
  id: string;
  committed: CommittedCustomBaseline;
  row: ScoredParamRow | null;
};

/** 本地草稿 + text 输入，避免受控 number 无法删首位 */
function ParamNumberInput({
  value,
  onValueChange,
  className,
  decimal = false,
}: {
  value: number;
  onValueChange: (n: number) => void;
  className?: string;
  decimal?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = (raw: string) => {
    setDraft(raw);
    if (raw === "" || raw === "-") return;
    const n = decimal ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) onValueChange(n);
  };

  return (
    <input
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      value={draft}
      onChange={(e) => commitDraft(e.target.value)}
      onBlur={() => {
        if (draft === "" || draft === "-") setDraft(String(value));
      }}
      className={className}
    />
  );
}

type RegistryCustomBaselineProps = {
  productSelected: boolean;
  kind: CustomBaselineKind;
  onKindChange: (kind: CustomBaselineKind) => void;
  form: CustomBaselineFormValues;
  onFormChange: (form: CustomBaselineFormValues) => void;
  onAdd: () => void;
  slots: CustomBaselineSlot[];
  /** 各策略类型已保存组数（切换类型时仍保留） */
  savedCountsByKind: Record<CustomBaselineKind, number>;
  onRemoveSlot: (id: string) => void;
  onClearAll: () => void;
  barsReady: boolean;
  addError: string | null;
  /** 嵌入独立折叠面板时去掉外层卡片，避免双层边框 */
  embedded?: boolean;
};

export function RegistryCustomBaseline({
  productSelected,
  kind,
  onKindChange,
  form,
  onFormChange,
  onAdd,
  slots,
  savedCountsByKind,
  onRemoveSlot,
  onClearAll,
  barsReady,
  addError,
  embedded = false,
}: RegistryCustomBaselineProps) {
  if (!productSelected) {
    return (
      <p className={`text-xs fin-muted-text${embedded ? " mt-3" : " mt-4"}`}>
        选择落地产品后，可先选策略类型并填写参数，点击「添加」生成对比
        Baseline（最多 {MAX_CUSTOM_BASELINES} 组）。
      </p>
    );
  }

  const patch = (partial: Partial<CustomBaselineFormValues>) =>
    onFormChange({ ...form, ...partial });

  const atMax = slots.length >= MAX_CUSTOM_BASELINES;
  const otherKindSaved = CUSTOM_BASELINE_KIND_OPTIONS.filter(
    (opt) => opt.id !== kind && (savedCountsByKind[opt.id] ?? 0) > 0,
  );
  const inputClass =
    "fin-input mt-1 block w-full px-2 py-1.5 font-mono text-sm";

  const paramFields = (() => {
    if (kind === "rsi") {
      return (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs fin-muted-text">
            <span className="fin-label">周期</span>
            {(["1d", "1w"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ rsiMode: mode })}
                className={`fin-chip-filter rounded-full px-2.5 py-1 ${
                  form.rsiMode === mode ? "fin-chip-filter-active" : ""
                }`}
              >
                {mode === "1d" ? "日线" : "周线"}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs fin-muted-text">
              RSI 周期
              <ParamNumberInput
                value={form.rsiPeriod}
                onValueChange={(rsiPeriod) => patch({ rsiPeriod })}
                className={inputClass}
              />
            </label>
            <label className="text-xs fin-muted-text">
              超卖
              <ParamNumberInput
                value={form.rsiOversold}
                onValueChange={(rsiOversold) => patch({ rsiOversold })}
                className={inputClass}
              />
            </label>
            <label className="text-xs fin-muted-text">
              超买
              <ParamNumberInput
                value={form.rsiOverbought}
                onValueChange={(rsiOverbought) => patch({ rsiOverbought })}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      );
    }
    if (kind === "boll") {
      return (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs fin-muted-text">
            <span className="fin-label">周期</span>
            {(["1d", "1w"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ bollMode: mode })}
                className={`fin-chip-filter rounded-full px-2.5 py-1 ${
                  form.bollMode === mode ? "fin-chip-filter-active" : ""
                }`}
              >
                {mode === "1d" ? "日线" : "周线"}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs fin-muted-text">
              布林周期
              <ParamNumberInput
                value={form.bollPeriod}
                onValueChange={(bollPeriod) => patch({ bollPeriod })}
                className={inputClass}
              />
            </label>
            <label className="text-xs fin-muted-text">
              标准差倍数
              <ParamNumberInput
                value={form.bollStd}
                onValueChange={(bollStd) => patch({ bollStd })}
                decimal
                className={inputClass}
              />
            </label>
          </div>
        </div>
      );
    }
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs fin-muted-text">
          快线
          <ParamNumberInput
            value={form.maFast}
            onValueChange={(maFast) => patch({ maFast })}
            className={inputClass}
          />
        </label>
        <label className="text-xs fin-muted-text">
          慢线
          <ParamNumberInput
            value={form.maSlow}
            onValueChange={(maSlow) => patch({ maSlow })}
            className={inputClass}
          />
        </label>
        <p className="sm:col-span-2 text-[10px] fin-muted-text">
          MA 金叉：慢线须大于快线
        </p>
      </div>
    );
  })();

  const shellClass = embedded
    ? "mt-3"
    : "fin-panel fin-panel-muted mt-6 px-4 py-3";

  return (
    <div className={shellClass}>
      {!embedded ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fin-muted)]">
            自定义参数 · 对比 Baseline
          </p>
          <p className="mt-1 text-[11px] fin-muted-text">
            先选策略类型，填写参数后点击「添加」；最多 {MAX_CUSTOM_BASELINES}{" "}
            组，结果表按组显示 vs 自定义列。
          </p>
        </div>
      ) : null}

      <p className={`text-xs fin-muted-text${embedded ? " mt-0" : " mt-3"}`}>
        策略类型
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {CUSTOM_BASELINE_KIND_OPTIONS.map((opt) => {
          const active = kind === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onKindChange(opt.id)}
              className={`fin-chip-filter rounded-full px-3 py-1.5 text-sm ${
                active ? "fin-chip-filter-active" : ""
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {paramFields}

      {otherKindSaved.length > 0 ? (
        <p className="mt-3 text-[11px] fin-muted-text">
          已保存（切换类型可继续查看）：
          {CUSTOM_BASELINE_KIND_OPTIONS.map((opt) => {
            const n = savedCountsByKind[opt.id] ?? 0;
            if (!n) return null;
            return (
              <span key={opt.id} className="ml-2">
                {opt.label} {n} 组
              </span>
            );
          })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAdd}
          disabled={!barsReady || atMax}
          className="fin-btn-primary px-4 py-2 text-sm disabled:opacity-50"
        >
          添加并计算对比
        </button>
        {slots.length > 0 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-lg border border-fin-border px-3 py-1.5 text-xs fin-muted-text hover:bg-fin-panel-muted"
          >
            清除全部
          </button>
        ) : null}
        {atMax ? (
          <span className="text-xs fin-muted-text">
            已达 {MAX_CUSTOM_BASELINES} 组上限
          </span>
        ) : null}
        {!barsReady ? (
          <span className="text-xs text-[var(--fin-amber)]">
            K 线不足 40 根，无法计算
          </span>
        ) : null}
      </div>

      {addError ? (
        <p className="mt-2 text-xs text-red-400">{addError}</p>
      ) : null}

      {slots.length === 0 ? (
        <p className="mt-3 text-xs fin-muted-text">
          填写参数后点击「添加并计算对比」，会在结果表中展示为对照行（最多{" "}
          {MAX_CUSTOM_BASELINES} 组）。
        </p>
      ) : (
        <ul className="fin-soft-divider mt-3 space-y-2 pt-3">
          {slots.map((slot, index) => (
            <li
              key={slot.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[rgba(148,163,184,0.14)] bg-fin-panel-muted/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--fin-text)]">
                  自定义 {index + 1}
                  {slot.row ? (
                    <span className="ml-2 font-normal text-[var(--fin-text)]">
                      {slot.row.label}
                    </span>
                  ) : (
                    <span className="ml-2 font-normal text-red-400/90">
                      计算失败
                    </span>
                  )}
                </p>
                {slot.row ? (
                  <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <span>
                      <span className="fin-muted-text">策略收益 </span>
                      <span className="font-mono text-[var(--fin-text)]">
                        {formatPct(slot.row.cumReturnPct)}
                      </span>
                    </span>
                    <span>
                      <span className="fin-muted-text">全样本超额 </span>
                      <span className="font-mono text-[var(--fin-blue)]">
                        {formatSignedPct(slot.row.excessReturnPct)}
                      </span>
                    </span>
                    <span>
                      <span className="fin-muted-text">验证超额 </span>
                      <span className="font-mono text-[var(--fin-blue-bright)]">
                        {formatSignedPct(slot.row.excessValPct)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] fin-muted-text">
                    参数无效或样本不足，请删除后重新添加。
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveSlot(slot.id)}
                className="shrink-0 rounded-lg border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
