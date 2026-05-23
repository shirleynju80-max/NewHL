import type { BondAnchorId } from "../types";
import { bondAnchorShortLabel } from "../lib/bondAnchor";

type BondAnchorToggleProps = {
  value: BondAnchorId;
  onChange: (anchor: BondAnchorId) => void;
};

export function BondAnchorToggle({ value, onChange }: BondAnchorToggleProps) {
  const options: BondAnchorId[] = ["CN_10Y", "US_10Y"];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="fin-label shrink-0">国债基准</span>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`fin-chip-filter ${value === id ? "fin-chip-filter-active" : ""}`}
          aria-pressed={value === id}
        >
          {bondAnchorShortLabel(id)}
        </button>
      ))}
    </div>
  );
}
