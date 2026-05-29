import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

function parseYmd(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function clampIso(iso: string, min: string, max: string): string {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function addMonths(
  y: number,
  m: number,
  delta: number,
): { y: number; m: number } {
  const d = new Date(y, m - 1 + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

type DayCell = {
  y: number;
  m: number;
  d: number;
  iso: string;
  inMonth: boolean;
  disabled: boolean;
};

function buildMonthGrid(
  y: number,
  m: number,
  min: string,
  max: string,
  allowed?: Set<string>,
): DayCell[] {
  const dim = daysInMonth(y, m);
  const firstDow = new Date(y, m - 1, 1).getDay();
  const cells: DayCell[] = [];
  const prev = addMonths(y, m, -1);
  const prevDim = daysInMonth(prev.y, prev.m);
  for (let i = firstDow - 1; i >= 0; i -= 1) {
    const d = prevDim - i;
    const iso = toIso(prev.y, prev.m, d);
    const disabled =
      iso < min || iso > max || (allowed != null && !allowed.has(iso));
    cells.push({ y: prev.y, m: prev.m, d, iso, inMonth: false, disabled });
  }
  for (let d = 1; d <= dim; d += 1) {
    const iso = toIso(y, m, d);
    const disabled =
      iso < min || iso > max || (allowed != null && !allowed.has(iso));
    cells.push({ y, m, d, iso, inMonth: true, disabled });
  }
  const next = addMonths(y, m, 1);
  let d = 1;
  while (cells.length < 42) {
    const iso = toIso(next.y, next.m, d);
    const disabled =
      iso < min || iso > max || (allowed != null && !allowed.has(iso));
    cells.push({ y: next.y, m: next.m, d, iso, inMonth: false, disabled });
    d += 1;
  }
  return cells;
}

function MonthPanel({
  y,
  m,
  min,
  max,
  allowed,
  rangeStart,
  rangeEnd,
  hoverIso,
  onPick,
  onHover,
  onNav,
}: {
  y: number;
  m: number;
  min: string;
  max: string;
  allowed?: Set<string>;
  rangeStart: string | null;
  rangeEnd: string | null;
  hoverIso: string | null;
  onPick: (iso: string) => void;
  onHover: (iso: string | null) => void;
  onNav: (deltaMonth: number) => void;
}) {
  const cells = useMemo(
    () => buildMonthGrid(y, m, min, max, allowed),
    [y, m, min, max, allowed],
  );
  const lo =
    rangeStart && rangeEnd && rangeStart <= rangeEnd ? rangeStart : rangeStart;
  const hi =
    rangeStart && rangeEnd && rangeStart <= rangeEnd
      ? rangeEnd
      : (rangeEnd ?? rangeStart);

  return (
    <div className="csi-cal-panel">
      <div className="csi-cal-header">
        <button
          type="button"
          className="csi-cal-nav"
          onClick={() => onNav(-12)}
          title="上一年"
        >
          «
        </button>
        <button
          type="button"
          className="csi-cal-nav"
          onClick={() => onNav(-1)}
          title="上一月"
        >
          ‹
        </button>
        <span className="csi-cal-title">
          {y}年 {m}月
        </span>
        <button
          type="button"
          className="csi-cal-nav"
          onClick={() => onNav(1)}
          title="下一月"
        >
          ›
        </button>
        <button
          type="button"
          className="csi-cal-nav"
          onClick={() => onNav(12)}
          title="下一年"
        >
          »
        </button>
      </div>
      <div className="csi-cal-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="csi-cal-grid">
        {cells.map((cell) => {
          const inRange =
            lo && hi && !cell.disabled && cell.iso >= lo && cell.iso <= hi;
          const isStart = cell.iso === rangeStart;
          const isEnd = cell.iso === rangeEnd;
          const inHover =
            rangeStart &&
            !rangeEnd &&
            hoverIso &&
            !cell.disabled &&
            ((cell.iso >= rangeStart && cell.iso <= hoverIso) ||
              (cell.iso <= rangeStart && cell.iso >= hoverIso));
          return (
            <button
              key={cell.iso + (cell.inMonth ? "" : "-x")}
              type="button"
              disabled={cell.disabled}
              className={[
                "csi-cal-day",
                !cell.inMonth ? "csi-cal-day-out" : "",
                inRange ? "csi-cal-day-in-range" : "",
                inHover ? "csi-cal-day-in-hover" : "",
                isStart || isEnd ? "csi-cal-day-endpoint" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => !cell.disabled && onHover(cell.iso)}
              onMouseLeave={() => onHover(null)}
              onClick={() => !cell.disabled && onPick(cell.iso)}
            >
              {cell.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export type CsIndexRangePickerProps = {
  start: string;
  end: string;
  min: string;
  max: string;
  onChange: (start: string, end: string) => void;
  /** 仅允许选择的交易日（不传则 min/max 内均可选） */
  tradingDates?: string[];
  placeholder?: string;
};

export function CsIndexRangePicker({
  start,
  end,
  min,
  max,
  onChange,
  tradingDates,
  placeholder = "开始日期  至  结束日期",
}: CsIndexRangePickerProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const safeStart = clampIso(start || min, min, max);
  const safeEnd = clampIso(end || max, min, max);
  const [draftStart, setDraftStart] = useState(safeStart);
  const [draftEnd, setDraftEnd] = useState(safeEnd);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [hoverIso, setHoverIso] = useState<string | null>(null);

  const endParts = parseYmd(safeEnd) ?? parseYmd(max)!;
  const [viewM, setViewM] = useState(() => {
    const p = addMonths(endParts.y, endParts.m, -1);
    return p.m;
  });
  const [viewYLeft, setViewYLeft] = useState(() => {
    const p = addMonths(endParts.y, endParts.m, -1);
    return p.y;
  });

  const allowed = useMemo(
    () => (tradingDates?.length ? new Set(tradingDates) : undefined),
    [tradingDates],
  );

  const rightMonth = useMemo(
    () => addMonths(viewYLeft, viewM, 1),
    [viewYLeft, viewM],
  );

  useEffect(() => {
    if (!open) return;
    setDraftStart(safeStart);
    setDraftEnd(safeEnd);
    setPendingStart(null);
    const p = parseYmd(safeEnd) ?? parseYmd(max)!;
    const left = addMonths(p.y, p.m, -1);
    setViewYLeft(left.y);
    setViewM(left.m);
  }, [open, safeStart, safeEnd, max]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = () => {
      const rect = rootRef.current!.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element).closest?.(".csi-range-dropdown")) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function shiftView(deltaMonth: number) {
    const next = addMonths(viewYLeft, viewM, deltaMonth);
    setViewYLeft(next.y);
    setViewM(next.m);
  }

  function pickDay(iso: string) {
    if (!pendingStart) {
      setPendingStart(iso);
      setDraftStart(iso);
      setDraftEnd(iso);
      return;
    }
    const a = pendingStart;
    const b = iso;
    const lo = a <= b ? a : b;
    const hi = a <= b ? b : a;
    setDraftStart(lo);
    setDraftEnd(hi);
    setPendingStart(null);
    onChange(lo, hi);
    setOpen(false);
  }

  function applyNav(delta: number, panel: "left" | "right") {
    if (panel === "left") shiftView(delta);
    else {
      const base = addMonths(viewYLeft, viewM, 1);
      const next = addMonths(base.y, base.m, delta);
      const left = addMonths(next.y, next.m, -1);
      setViewYLeft(left.y);
      setViewM(left.m);
    }
  }

  const display =
    safeStart && safeEnd ? `${safeStart}  至  ${safeEnd}` : placeholder;

  const years = useMemo(() => {
    const a = parseYmd(min)!.y;
    const b = parseYmd(max)!.y;
    const out: number[] = [];
    for (let y = a; y <= b; y += 1) out.push(y);
    return out;
  }, [min, max]);

  function jumpYearMonth(y: number, m: number) {
    const left = addMonths(y, m, -1);
    setViewYLeft(left.y);
    setViewM(left.m);
  }

  return (
    <div ref={rootRef} className="csi-range-picker relative">
      <button
        type="button"
        id={id}
        className="csi-range-trigger fin-interactive"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="csi-range-trigger-text">{display}</span>
        <span className="csi-range-trigger-icon" aria-hidden>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
      </button>

      {open
        ? createPortal(
            <div
              className="csi-range-dropdown fin-panel"
              role="dialog"
              aria-labelledby={id}
              style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
              }}
            >
              <div className="csi-range-toolbar">
                <label className="csi-range-toolbar-label">
                  年份
                  <select
                    className="fin-select csi-range-year-select"
                    value={viewYLeft}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      jumpYearMonth(y, viewM);
                    }}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="csi-cal-nav csi-range-today"
                  onClick={() => {
                    const p = parseYmd(max)!;
                    jumpYearMonth(p.y, p.m);
                  }}
                >
                  转至最新
                </button>
              </div>
              <div className="csi-range-calendars">
                <MonthPanel
                  y={viewYLeft}
                  m={viewM}
                  min={min}
                  max={max}
                  allowed={allowed}
                  rangeStart={pendingStart ?? draftStart}
                  rangeEnd={pendingStart ? null : draftEnd}
                  hoverIso={hoverIso}
                  onPick={pickDay}
                  onHover={setHoverIso}
                  onNav={(d) => applyNav(d, "left")}
                />
                <MonthPanel
                  y={rightMonth.y}
                  m={rightMonth.m}
                  min={min}
                  max={max}
                  allowed={allowed}
                  rangeStart={pendingStart ?? draftStart}
                  rangeEnd={pendingStart ? null : draftEnd}
                  hoverIso={hoverIso}
                  onPick={pickDay}
                  onHover={setHoverIso}
                  onNav={(d) => applyNav(d, "right")}
                />
              </div>
              <p className="csi-range-hint">
                点击两次选择起止日期；仅可选有行情的交易日。
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export type CsIndexDatePickerProps = {
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
  tradingDates?: string[];
  placeholder?: string;
  label?: string;
};

/** 单日选择（起、止各用一个，互不联动） */
export function CsIndexDatePicker({
  value,
  min,
  max,
  onChange,
  tradingDates,
  placeholder = "选择日期",
  label,
}: CsIndexDatePickerProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const safeValue = clampIso(value || max, min, max);
  const valueParts = parseYmd(safeValue) ?? parseYmd(max)!;
  const [viewY, setViewY] = useState(valueParts.y);
  const [viewM, setViewM] = useState(valueParts.m);

  const allowed = useMemo(
    () => (tradingDates?.length ? new Set(tradingDates) : undefined),
    [tradingDates],
  );

  useEffect(() => {
    if (!open) return;
    const p = parseYmd(safeValue) ?? parseYmd(max)!;
    setViewY(p.y);
    setViewM(p.m);
  }, [open, safeValue, max]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const update = () => {
      const rect = rootRef.current!.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((e.target as Element).closest?.(".csi-date-dropdown")) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function shiftView(deltaMonth: number) {
    const next = addMonths(viewY, viewM, deltaMonth);
    setViewY(next.y);
    setViewM(next.m);
  }

  function pickDay(iso: string) {
    onChange(iso);
    setOpen(false);
  }

  const display = safeValue || placeholder;
  const years = useMemo(() => {
    const a = parseYmd(min)!.y;
    const b = parseYmd(max)!.y;
    const out: number[] = [];
    for (let y = a; y <= b; y += 1) out.push(y);
    return out;
  }, [min, max]);

  return (
    <div ref={rootRef} className="csi-date-picker relative">
      <button
        type="button"
        id={id}
        className="csi-range-trigger fin-interactive"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="csi-range-trigger-text">
          {label ? <span className="csi-date-tag">{label}</span> : null}
          {display}
        </span>
        <span className="csi-range-trigger-icon" aria-hidden>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
      </button>

      {open
        ? createPortal(
            <div
              className="csi-date-dropdown csi-range-dropdown fin-panel"
              role="dialog"
              aria-labelledby={id}
              style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
              }}
            >
              <div className="csi-range-toolbar">
                <label className="csi-range-toolbar-label">
                  年份
                  <select
                    className="fin-select csi-range-year-select"
                    value={viewY}
                    onChange={(e) => {
                      const y = Number(e.target.value);
                      setViewY(y);
                    }}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="csi-cal-nav csi-range-today"
                  onClick={() => {
                    const p = parseYmd(max)!;
                    setViewY(p.y);
                    setViewM(p.m);
                  }}
                >
                  转至最新
                </button>
              </div>
              <MonthPanel
                y={viewY}
                m={viewM}
                min={min}
                max={max}
                allowed={allowed}
                rangeStart={safeValue}
                rangeEnd={safeValue}
                hoverIso={null}
                onPick={pickDay}
                onHover={() => {}}
                onNav={shiftView}
              />
              <p className="csi-range-hint">
                {label ? `${label}；` : ""}仅可选有行情的交易日。
              </p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** 与 CsIndexRangePicker 相同，供指数详情页使用 */
export function TradingDateRangePicker(props: CsIndexRangePickerProps) {
  return <CsIndexRangePicker {...props} />;
}
