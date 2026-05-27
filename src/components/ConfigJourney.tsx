import { Link, useLocation } from "react-router-dom";

const STEPS = [
  { to: "/", label: "理解框架", match: (p: string) => p === "/" },
  {
    to: "/indices",
    label: "指数研究",
    match: (p: string) => p.startsWith("/indices"),
  },
  {
    to: "/products",
    label: "产品选择",
    match: (p: string) => p.startsWith("/products"),
  },
  {
    to: "/monitor",
    label: "盘中监控",
    match: (p: string) => p.startsWith("/monitor"),
    optional: true,
  },
] as const;

export function ConfigJourney() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="配置路径" className="fin-journey">
      <span className="fin-journey-label">路径</span>
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((step, i) => {
          const active = step.match(pathname);
          return (
            <li key={step.to} className="flex items-center gap-2">
              {i > 0 ? (
                <span
                  className="font-mono text-[10px] text-[var(--fin-dim)]"
                  aria-hidden
                >
                  /
                </span>
              ) : null}
              <Link
                to={step.to}
                className={active ? "fin-step-active" : "fin-step-idle"}
              >
                <span className="mr-1.5 font-mono text-[10px] opacity-75">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {step.label}
                {"optional" in step && step.optional ? (
                  <span className="ml-1 text-[10px] font-normal opacity-75">
                    （可选）
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
