import type { ReactNode } from "react";
import { PageBreadcrumb, type BreadcrumbItem } from "./PageBreadcrumb";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  kicker?: string;
  children?: ReactNode;
};

export function PageHeader({ title, description, breadcrumbs, kicker, children }: PageHeaderProps) {
  return (
    <header className="fin-page-header">
      {breadcrumbs && breadcrumbs.length > 0 ? <PageBreadcrumb items={breadcrumbs} /> : null}
      {kicker ? <p className={`fin-kicker ${breadcrumbs?.length ? "mt-3" : ""}`}>{kicker}</p> : null}
      <h2 className={`fin-page-title ${breadcrumbs?.length || kicker ? "mt-1.5" : ""}`}>{title}</h2>
      {description ? <div className="fin-body mt-2 max-w-3xl">{description}</div> : null}
      {children}
    </header>
  );
}
