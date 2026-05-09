import { Link, Outlet, useLocation } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";

const nav = [
  { to: "/", label: "总览" },
  { to: "/monitor", label: "监控汇总" },
  { to: "/registry", label: "参数回测与注册" },
];

export function Layout() {
  const loc = useLocation();
  const { sourceLabel } = useDataSource();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-200/80 bg-white/90 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto max-w-6xl px-6 py-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-indigo-600">Dividend desk</p>
            <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">红利 ETF 看板</h1>
            <p className="text-sm text-zinc-500 mt-1">参数已定 · 回测与盘中分位</p>
            <p className="text-xs text-zinc-400 mt-2 font-mono">数据源：{sourceLabel}</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  loc.pathname === item.to
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
