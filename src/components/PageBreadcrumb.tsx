import { Link } from "react-router-dom";

export type BreadcrumbItem = {
 label: string;
 to?: string;
};

export function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
 return (
 <nav aria-label="面包屑" className="fin-breadcrumb">
 <ol>
 {items.map((item, i) => (
 <li key={`${item.label}-${i}`} className="inline-flex items-center gap-1.5">
 {i > 0 ?
 <span className="fin-muted-text" aria-hidden>
 /
 </span>
 : null}
 {item.to ?
 <Link to={item.to} className="fin-link">
 {item.label}
 </Link>
 : <span className="fin-muted-text">{item.label}</span>}
 </li>
 ))}
 </ol>
 </nav>
 );
}
