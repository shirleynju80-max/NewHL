import { Link, Outlet, useLocation } from "react-router-dom";
import { useDataSource } from "../context/DataSourceContext";

type NavItemDef = {
  to: string;
  label: string;
  hint?: string;
  match: (path: string) => boolean;
};

const mainNav: NavItemDef[] = [
  { to: "/", label: "配置总览", match: (path) => path === "/" },
  {
    to: "/indices",
    label: "指数研究",
    match: (path) => path.startsWith("/indices"),
  },
  {
    to: "/products",
    label: "产品选择",
    match: (path) => path.startsWith("/products"),
  },
  {
    to: "/monitor",
    label: "盘中监控",
    match: (path) => path.startsWith("/monitor"),
  },
  {
    to: "/featured-tracking",
    label: "精选跟踪",
    match: (path) => path.startsWith("/featured-tracking"),
  },
];

const toolNav: NavItemDef[] = [
  {
    to: "/registry",
    label: "策略研究",
    match: (path) => path.startsWith("/registry"),
  },
  {
    to: "/compare",
    label: "标的对比",
    match: (path) => path === "/compare",
  },
];

function FtNavLink({ item, active }: { item: NavItemDef; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={`ft-nav-link ${active ? "ft-nav-link--active" : ""}`}
    >
      {item.label}
      {item.hint ? (
        <span className="ml-0.5 font-normal opacity-70">（{item.hint}）</span>
      ) : null}
    </Link>
  );
}

export function Layout() {
  const loc = useLocation();
  const {
    loadError,
    indexCsvError,
  } = useDataSource();

  return (
    <div className="ft-app flex min-h-screen flex-col">
      {loadError && (
        <div className="border-b border-red-900/40 bg-red-950/90 px-4 py-2 text-sm text-red-100">
          {loadError}
        </div>
      )}
      {indexCsvError && (
        <div className="border-b border-amber-900/40 bg-amber-950/90 px-4 py-2 text-sm text-amber-100">
          {indexCsvError}
        </div>
      )}

      <div className="ft-dashboard mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 sm:px-6">
        <header className="ft-top-bar">
          <Link to="/" className="ft-logo group">
            <h1 className="ft-logo-title">价值底仓配置台</h1>
            <p className="ft-logo-sub">
              从现金创造与股东回报，构建长期资产底仓
            </p>
          </Link>
        </header>

        <nav className="ft-nav" aria-label="主导航">
          {mainNav.map((item) => (
            <FtNavLink
              key={item.to}
              item={item}
              active={item.match(loc.pathname)}
            />
          ))}
          <span className="ft-nav-divider" aria-hidden />
          {toolNav.map((item) => (
            <FtNavLink
              key={item.to}
              item={item}
              active={item.match(loc.pathname)}
            />
          ))}
        </nav>

        <main className="ft-main">
          <Outlet />
        </main>

      </div>
    </div>
  );
}
