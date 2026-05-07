import { useDataSource } from "../context/DataSourceContext";

export function RegistryPage() {
  const { definitions: etfDefinitions } = useDataSource();
  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">参数注册</h2>
        <p className="mt-2 text-sm text-zinc-500 max-w-2xl">
          MA / RSI / 布林带每类可多组 <code className="text-xs bg-zinc-100 px-1 rounded">variant_id</code>
          ，策略通过引用组合；版本与生效区间由 <code className="text-xs bg-zinc-100 px-1">param_version</code> 追溯。
        </p>
      </header>
      <div className="space-y-6">
        {etfDefinitions.map((e) => (
          <article
            key={e.meta.code}
            className="rounded-3xl border border-zinc-100 bg-white p-8 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-zinc-100 pb-6">
              <div>
                <p className="font-mono text-sm text-indigo-600">{e.meta.code}</p>
                <h3 className="text-lg font-semibold text-zinc-900">{e.meta.name}</h3>
              </div>
              <dl className="flex flex-wrap gap-6 text-sm">
                <div>
                  <dt className="text-zinc-400">品类</dt>
                  <dd className="font-medium text-zinc-800">{e.meta.product_kind}</dd>
                </div>
                <div>
                  <dt className="text-zinc-400">param_version</dt>
                  <dd className="font-mono text-zinc-800">{e.meta.param_version}</dd>
                </div>
                {e.meta.dividend_market_scope && (
                  <div>
                    <dt className="text-zinc-400">dividend_market_scope</dt>
                    <dd className="font-medium text-zinc-800">{e.meta.dividend_market_scope}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="mt-6 grid gap-8 lg:grid-cols-3">
              <VariantBlock title="MA" items={e.params.ma_variants} />
              <VariantBlock title="RSI" items={e.params.rsi_variants} />
              <VariantBlock title="布林带" items={e.params.bollinger_variants} />
            </div>
            <p className="mt-6 text-xs text-zinc-400">
              策略引用 MA：<span className="font-mono">{e.params.strategy_ma_ids.join(", ")}</span>
              {e.params.strategy_rsi_id && (
                <>
                  {" "}
                  · RSI：<span className="font-mono">{e.params.strategy_rsi_id}</span>
                </>
              )}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function VariantBlock<T extends { variant_id: string }>({
  title,
  items,
}: {
  title: string;
  items: T[];
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h4>
      <ul className="mt-3 space-y-2">
        {items.map((v) => (
          <li
            key={v.variant_id}
            className="rounded-xl bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700"
          >
            <span className="text-indigo-600">{v.variant_id}</span>
            <span className="text-zinc-400"> · </span>
            <span>{JSON.stringify(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
