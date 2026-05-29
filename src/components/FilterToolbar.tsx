import type { ReactNode } from "react";

export function FilterChipCount({ count }: { count: number }) {
  return (
    <span
      className="ml-0.5 font-mono text-[10px] font-normal tabular-nums text-[var(--fin-dim)]"
      title="当前筛选条件下符合的数量"
    >
      {count}
    </span>
  );
}

export function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <span className="shrink-0 px-0.5 text-[10px] font-medium tracking-wide text-[var(--fin-dim)]">
        {label}
      </span>
      {children}
    </div>
  );
}

export function FilterSep() {
  return (
    <span
      className="mx-0.5 hidden h-3.5 w-px shrink-0 bg-fin-border sm:inline-block"
      aria-hidden
    />
  );
}
