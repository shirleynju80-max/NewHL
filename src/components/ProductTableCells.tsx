import { formatAumCny, formatPct } from "../lib/formatDisplay";
import { productCandidateTags, type EtfProductRecord } from "../lib/etfProducts";

export function ProductFeeCell({ p }: { p: EtfProductRecord }) {
 const fee = p.totalFeePct ?? p.feePct;
 return <span className="font-mono text-xs">{fee != null ? formatPct(fee) : "—"}</span>;
}

export function ProductAumCell({ p }: { p: EtfProductRecord }) {
 return <span className="font-mono text-xs">{formatAumCny(p.aumCny)}</span>;
}

export function ProductCandidateTags({ p }: { p: EtfProductRecord }) {
 const tags = productCandidateTags(p.note);
 if (tags.length === 0) return <span className="text-xs text-[var(--fin-dim)]">—</span>;
 return (
 <span className="text-xs fin-muted-text" title={p.note}>
 {tags.join(" · ")}
 </span>
 );
}
