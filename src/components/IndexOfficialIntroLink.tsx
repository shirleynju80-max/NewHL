import { indexOfficialIntroUrl } from "../lib/indexOfficialLinks";
import type { IndexMeta } from "../types";

export function IndexOfficialIntroLink({
  meta,
  className = "text-sm fin-link",
  label = "官网介绍",
  missingClassName = "text-sm fin-muted-text",
}: {
  meta: Pick<IndexMeta, "index_code" | "methodology_url">;
  className?: string;
  label?: string;
  missingClassName?: string;
}) {
  const url = indexOfficialIntroUrl(meta);
  if (!url) {
    return <span className={missingClassName}>—</span>;
  }
  return (
    <a
      href={url}
      className={className}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}
