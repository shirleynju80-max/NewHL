import { Link, Outlet, useLocation } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";

const nav = [
  { to: "/", label: "ETF总览", match: (path: string) => path === "/" },
  { to: "/indices", label: "了解指数", match: (path: string) => path.startsWith("/indices") },
  { to: "/monitor", label: "盘中信号", match: (path: string) => path.startsWith("/monitor") },
  { to: "/registry", label: "策略回测与注册", match: (path: string) => path.startsWith("/registry") },
];

export function Layout() {
  const loc = useLocation();
  const { sourceLabel, loadError, indexCsvError, definitions, reloadPublicCsv, reloadingPublicCsv } =
    useDataSource();
  return (
    <div className="min-h-screen flex flex-col">
      {loadError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-900">
          <strong className="font-semibold">数据加载提示：</strong>
          {loadError}
        </div>
      )}
      {indexCsvError && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-950">
          <strong className="font-semibold">指数数据提示：</strong>
          {indexCsvError}
        </div>
      )}
      <header className="border-b border-zinc-200/80 bg-white/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-6 py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-indigo-600">Dividend desk</p>
            <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">红利 ETF 看板</h1>
            <p className="text-sm text-zinc-500 mt-1">回测、盘中分位与观测列表</p>
            <p className="text-xs text-zinc-400 mt-2 flex flex-wrap items-center gap-2">
              <span>
                当前数据：{sourceLabel} · 标的数 {definitions.length}
              </span>
              <button
                type="button"
                onClick={() => void reloadPublicCsv()}
                disabled={reloadingPublicCsv}
                className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                {reloadingPublicCsv ? "加载中…" : "重新加载 public/data"}
              </button>
            </p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  item.match(loc.pathname)
                    ? "bg-zinc-900 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-200/80 py-8 text-center text-xs text-zinc-400">
        示例数据仅供 UI / 逻辑演示，不构成投资建议。
      </footer>
    </div>
  );
}
