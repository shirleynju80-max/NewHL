type SectionLink = {
  id: string;
  label: string;
};

type IndexDetailSectionNavProps = {
  hasBars: boolean;
  showSpread: boolean;
};

export function IndexDetailSectionNav({
  hasBars,
  showSpread,
}: IndexDetailSectionNavProps) {
  const items: SectionLink[] = [
    { id: "section-conclusion", label: "研究结论" },
    { id: "section-meta", label: "基本信息" },
    ...(hasBars
      ? [
          { id: "section-perf", label: "绩效" },
          { id: "section-chart", label: "走势" },
          { id: "section-metrics", label: "指标表" },
        ]
      : []),
    ...(showSpread ? [{ id: "section-spread", label: "股息利差" }] : []),
    { id: "section-products", label: "跟踪产品" },
  ];

  return (
    <nav aria-label="页内导航" className="fin-subnav">
      <span className="fin-kicker mr-1 hidden sm:inline">章节</span>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className="fin-chip-filter fin-section-scroll"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
