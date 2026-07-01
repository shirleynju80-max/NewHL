"""Incremental merge + post-sync verification for index_bars.csv."""

from __future__ import annotations

from typing import Any

# 重叠窗口：仅刷新末段并核对官方是否修订；更早日期原样保留。
INCREMENTAL_OVERLAP_CALENDAR_DAYS = 10
# 单次请求回溯日历天数（含重叠区），减轻 CSI 全量 403。
INCREMENTAL_FETCH_CALENDAR_DAYS = 120

# 重叠区内官方修订超过该相对偏差则告警（指数点位单位，非 ETF 前复权）。
OVERLAP_DRIFT_REL_EPS = 1e-4
OVERLAP_DRIFT_ABS_EPS = 0.02
# 重叠区修订超过该比例视为错源（如 EM 把价格指数写入 TRI），保留基线。
OVERLAP_DRIFT_REJECT_REL = 0.05
# 保留区历史点位允许的最大绝对差（浮点/四舍五入）。
PRESERVED_CLOSE_ABS_EPS = 0.02
# TRI / price 比例理论上只随分红缓慢变化；大跳通常意味着价格指数与全收益指数拼接。
TRI_PRICE_RATIO_JUMP_REJECT_REL = 0.05


def incremental_fetch_start(baseline: dict[str, float], *, lookback_days: int | None = None) -> str:
    from sync_a_share_dividend_indices import tail_start_date

    return tail_start_date(
        baseline,
        lookback_days=lookback_days or INCREMENTAL_FETCH_CALENDAR_DAYS,
    )


def incremental_preserve_before(baseline: dict[str, float]) -> str:
    from sync_a_share_dividend_indices import tail_start_date

    return tail_start_date(baseline, lookback_days=INCREMENTAL_OVERLAP_CALENDAR_DAYS)


def merge_incremental_close_series(
    baseline: dict[str, float],
    fetched: dict[str, float],
    *,
    code: str,
    field: str,
) -> tuple[dict[str, float], dict[str, Any]]:
    if not baseline:
        return dict(fetched), {"sync_mode": "full"}
    if not fetched:
        return dict(baseline), {"sync_mode": "incremental-unchanged"}

    preserve_before = incremental_preserve_before(baseline)
    merged: dict[str, float] = {d: v for d, v in baseline.items() if d < preserve_before}
    drifts: list[tuple[str, float, float, float]] = []

    for d, new_v in sorted(fetched.items()):
        if d < preserve_before:
            continue
        old_v = baseline.get(d)
        if old_v is not None and old_v > 0:
            rel = abs(new_v - old_v) / old_v
            if rel > OVERLAP_DRIFT_REL_EPS and abs(new_v - old_v) > OVERLAP_DRIFT_ABS_EPS:
                drifts.append((d, old_v, new_v, rel))
                if rel > OVERLAP_DRIFT_REJECT_REL:
                    print(
                        f"::warning::{code} {field} reject overlap {d} "
                        f"rel={rel:.2%} ({old_v:.4f}->{new_v:.4f}), keep baseline",
                    )
                    merged[d] = old_v
                    continue
        merged[d] = new_v

    for d, old_v in baseline.items():
        if d >= preserve_before and d not in fetched:
            merged[d] = old_v

    meta: dict[str, Any] = {
        "sync_mode": "incremental",
        "preserve_before": preserve_before,
        "baseline_last": max(baseline),
        "fetched_from": min(fetched),
        "fetched_to": max(fetched),
        "merged_last": max(merged) if merged else None,
        "drift_days": len(drifts),
    }
    if drifts:
        sample = drifts[0]
        print(
            f"::warning::{code} {field} incremental overlap revised {len(drifts)} day(s); "
            f"sample {sample[0]} {sample[1]:.4f}->{sample[2]:.4f}",
        )
    return merged, meta


def rows_to_close_map(rows: list[dict[str, str]], *, price_key: str = "price_close") -> dict[str, float]:
    out: dict[str, float] = {}
    for row in rows:
        d = (row.get("date") or "").strip()
        raw = (row.get(price_key) or "").strip()
        if not d or not raw:
            continue
        try:
            out[d] = float(raw)
        except ValueError:
            continue
    return out


def group_rows_by_code(rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    out: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        code = (row.get("index_code") or "").strip()
        if code:
            out.setdefault(code, []).append(row)
    return out


def verify_index_bars_consistency(
    before_by_code: dict[str, list[dict[str, str]]],
    after_by_code: dict[str, list[dict[str, str]]],
    *,
    replace_codes: set[str],
) -> None:
    errors: list[str] = []
    for code in sorted(replace_codes):
        before = before_by_code.get(code, [])
        after = after_by_code.get(code, [])
        if not after and before:
            errors.append(f"{code}: rows disappeared ({len(before)} -> 0)")
            continue
        if not after:
            continue

        before_dates = sorted({r["date"] for r in before if r.get("date")})
        after_dates = sorted({r["date"] for r in after if r.get("date")})
        if len(after_dates) != len(set(after_dates)):
            errors.append(f"{code}: duplicate dates in output")

        if before_dates and after_dates and after_dates[0] > before_dates[0]:
            errors.append(f"{code}: history truncated {before_dates[0]} -> {after_dates[0]}")

        if before and len(after) < len(before):
            errors.append(f"{code}: row count dropped {len(before)} -> {len(after)}")

        if before:
            preserve_before = incremental_preserve_before(rows_to_close_map(before))
            after_by_date = {r["date"]: r for r in after if r.get("date")}
            for row in before:
                d = row.get("date") or ""
                if not d or d >= preserve_before:
                    continue
                new_row = after_by_date.get(d)
                if not new_row:
                    errors.append(f"{code}: missing preserved history {d}")
                    continue
                for col in ("price_close", "tri_close"):
                    old_raw = (row.get(col) or "").strip()
                    new_raw = (new_row.get(col) or "").strip()
                    if not old_raw or not new_raw:
                        continue
                    if abs(float(old_raw) - float(new_raw)) > PRESERVED_CLOSE_ABS_EPS:
                        errors.append(
                            f"{code}: {col} changed before overlap {d} ({old_raw} -> {new_raw})",
                        )

        ratio_rows: list[tuple[str, float]] = []
        for row in sorted(after, key=lambda r: r.get("date") or ""):
            d = (row.get("date") or "").strip()
            price_raw = (row.get("price_close") or "").strip()
            tri_raw = (row.get("tri_close") or "").strip()
            if not d or not price_raw or not tri_raw:
                continue
            price = float(price_raw)
            tri = float(tri_raw)
            if price > 0 and tri > 0:
                ratio_rows.append((d, tri / price))
        for (prev_d, prev_ratio), (d, ratio) in zip(ratio_rows, ratio_rows[1:]):
            rel = abs(ratio / prev_ratio - 1) if prev_ratio else 0
            if rel > TRI_PRICE_RATIO_JUMP_REJECT_REL:
                errors.append(
                    f"{code}: tri/price ratio jumped {rel:.2%} on {d} "
                    f"({prev_d} {prev_ratio:.6f} -> {ratio:.6f})",
                )

    if errors:
        for msg in errors:
            print(f"::error::index_bars verify: {msg}")
        raise SystemExit(1)
    print(f"index_bars verify ok ({len(replace_codes)} sync targets checked)")
