import { useMemo } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";
import { latestTradeDate } from "../lib/dataFreshness";
import { isEtfProductListed } from "../lib/etfListingAge";

type NavItemDef = {
  to: string;
  label: string;
  hint?: string;
  match: (path: string) => boolean;
};

const mainNav: NavItemDef[] = [
  { to: "/", label: "配置总览", match: (path) => path === "/" },
  { to: "/indices", label: "指数研究", match: (path) => path.startsWith("/indices") },
  { to: "/products", label: "产品选择", match: (path) => path.startsWith("/products") },
  { to: "/monitor", label: "盘中监控", match: (path) => path.startsWith("/monitor") },
];

const toolNav: NavItemDef[] = [
  {
    to: "/registry",
    label: "策略研究工具",
    hint: "策略研究",
    match: (path) => path.startsWith("/registry"),
  },
  {
    to: "/compare",
    label: "ETF对比工具",
    hint: "标的对比",
    match: (path) => path === "/compare",
  },
];

function NavLink({ item, active }: { item: NavItemDef; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={`fin-nav-item shrink-0 ${active ? "fin-nav-item-active" : "fin-nav-item-idle"}`}
    >
      {item.label}
      {item.hint ?
        <span className="ml-0.5 font-normal opacity-75">（{item.hint}）</span>
      : null}
    </Link>
  );
}

export function Layout() {
  const loc = useLocation();
  const {
    sourceKind,
    loadError,
    indexCsvError,
    definitions,
    indices,
    etfProducts,
    reloadPublicCsv,
    reloadingPublicCsv,
    publicCsvAutoLoading,
  } = useDataSource();

  const defByCode = useMemo(() => new Map(definitions.map((d) => [d.meta.code, d])), [definitions]);

  const poolStats = useMemo(() => {
    const listed = etfProducts.filter((p) => isEtfProductListed(defByCode.get(p.code), p));
    return {
      indexCount: new Set(etfProducts.map((p) => p.indexCode)).size,
      listedCount: listed.length,
      poolCount: etfProducts.length,
    };
  }, [etfProducts, defByCode]);

  const dataDate = useMemo(() => latestTradeDate(definitions, indices), [definitions, indices]);
  const statusLine = useMemo(() => {
    if (publicCsvAutoLoading) return "加载中";
    if (sourceKind === "mock") return "演示";
    if (dataDate) return dataDate;
    return "—";
  }, [publicCsvAutoLoading, sourceKind, dataDate]);

  return (
    <div className="flex min-h-screen flex-col">
      {loadError && (
        <div className="border-b border-red-900/30 bg-red-950 px-4 py-2 text-sm text-red-100">{loadError}</div>
      )}
      {indexCsvError && (
        <div className="border-b border-amber-900/30 bg-amber-950 px-4 py-2 text-sm text-amber-100">{indexCsvError}</div>
      )}

      <header className="fin-header">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <Link to="/" className="group shrink-0 cursor-pointer">
            <p className="fin-brand-kicker">价值底仓 · 研究配置</p>
            <h1 className="fin-brand-title mt-1 text-lg sm:text-xl">配置台</h1>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-2 overflow-x-auto">
            <div className="flex flex-wrap gap-0.5">
              {mainNav.map((item) => (
                <NavLink key={item.to} item={item} active={item.match(loc.pathname)} />
              ))}
            </div>
            <span className="hidden h-5 w-px bg-slate-600/80 sm:block" aria-hidden />
            <div className="flex flex-wrap gap-0.5">
              <span className="sr-only">策略研究工具</span>
              {toolNav.map((item) => (
                <NavLink key={item.to} item={item} active={item.match(loc.pathname)} />
              ))}
            </div>
          </nav>
        </div>
        <div className="fin-ticker">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5">
            <span>
              <span className="fin-muted-text text-slate-500">行情截至 </span>
              <span className="fin-ticker-value font-mono">{statusLine}</span>
            </span>
            <span className="fin-muted-text text-slate-500">
              观察池{" "}
              <span className="fin-ticker-value font-mono">
                {poolStats.indexCount} 指数 · {poolStats.listedCount}/{poolStats.poolCount} 只可交易
              </span>
            </span>
            <button
              type="button"
              onClick={() => void reloadPublicCsv()}
              disabled={reloadingPublicCsv || publicCsvAutoLoading}
              title="重新加载 public/data 下的 CSV，不是浏览器刷新"
              className="fin-ticker-btn"
            >
              {reloadingPublicCsv || publicCsvAutoLoading ? "加载中…" : "重载 CSV"}
            </button>
          </div>
        </div>
      </header>

      <main className="fin-main">
        <Outlet />
      </main>

      <footer className="fin-footer">仅供研究参考，不构成投资建议</footer>
    </div>
  );
}
