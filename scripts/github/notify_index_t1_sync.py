from __future__ import annotations

import base64
import dataclasses
import datetime as dt
import hashlib
import hmac
import os
import time
from zoneinfo import ZoneInfo

import requests


EARLY_SCHEDULE_CRON = "35 10 * * 1-5"
FINAL_SCHEDULE_CRON = "35 12 * * 1-5"


@dataclasses.dataclass(frozen=True)
class NotificationDecision:
    should_notify: bool
    level: str
    reason: str


def notification_decision(
    *,
    status: str,
    warnings: list[str],
    event_name: str,
    schedule_cron: str,
    has_same_day_success: bool,
) -> NotificationDecision:
    if status == "success" and not warnings:
        return NotificationDecision(False, "INFO", "no warning/failure")

    if event_name == "schedule" and schedule_cron == EARLY_SCHEDULE_CRON:
        return NotificationDecision(False, "INFO", "early scheduled failure/warning deferred")

    if event_name == "schedule" and status != "success" and has_same_day_success:
        if not warnings:
            return NotificationDecision(False, "INFO", "same-day scheduled run already succeeded")
        return NotificationDecision(True, "WARN", "same-day failure suppressed; warnings remain")

    return NotificationDecision(True, "WARN" if status == "success" else "ERROR", "notify")


def build_warnings() -> list[str]:
    credentials_present = os.getenv("HSI_CREDENTIALS_PRESENT", "") == "true"
    hsi_outcome = os.getenv("HSI_SYNC_OUTCOME", "")
    hsi_stale = os.getenv("HSI_STALE", "")

    hsi_data_stale = bool(hsi_stale) and hsi_stale != "none"
    warnings: list[str] = []
    if hsi_data_stale:
        if credentials_present:
            warnings.append(
                f"HSI 数据已过期，请检查 HSI_LOGIN_USERNAME/HSI_LOGIN_PASSWORD 或同步脚本：{hsi_stale}"
            )
        else:
            warnings.append(f"HSI 数据已过期且未配置 HSI 登录凭据：{hsi_stale}")
    elif credentials_present and hsi_outcome == "failure":
        print("HSI 同步失败，但数据仍在容忍期内（未超过 HSI_STALE_DAYS），本次不发告警。")
    elif not credentials_present:
        print("HSI 登录凭据未配置，但数据仍在容忍期内，本次不发告警。")
    return warnings


def beijing_date_from_iso(value: str) -> dt.date | None:
    if not value:
        return None
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.astimezone(ZoneInfo("Asia/Shanghai")).date()


def has_same_day_successful_scheduled_run() -> bool:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    repo = os.getenv("REPO", "").strip()
    run_id = os.getenv("RUN_ID", "").strip()
    workflow_file = os.getenv("WORKFLOW_FILE", "index-t1-sync.yml").strip()
    api_url = os.getenv("GITHUB_API_URL", "https://api.github.com").rstrip("/")
    branch = os.getenv("GITHUB_REF_NAME", "main").strip() or "main"
    target_date = dt.datetime.now(ZoneInfo("Asia/Shanghai")).date()

    if not token or not repo:
        print("GitHub token/repo missing; cannot check same-day successful runs.")
        return False

    url = f"{api_url}/repos/{repo}/actions/workflows/{workflow_file}/runs"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    params = {"event": "schedule", "branch": branch, "per_page": "30"}
    try:
        response = requests.get(url, headers=headers, params=params, timeout=15)
        response.raise_for_status()
        runs = response.json().get("workflow_runs") or []
    except Exception as exc:
        print(f"Failed to inspect same-day workflow runs: {exc}")
        return False

    for run in runs:
        if str(run.get("id") or "") == run_id:
            continue
        if run.get("conclusion") != "success":
            continue
        if beijing_date_from_iso(run.get("created_at") or "") == target_date:
            print(f"Found same-day successful scheduled run: {run.get('html_url')}")
            return True
    return False


def signed_feishu_payload(text: str, secret: str) -> dict[str, object]:
    payload: dict[str, object] = {"msg_type": "text", "content": {"text": text}}
    if not secret:
        return payload

    timestamp = str(int(time.time()))
    string_to_sign = f"{timestamp}\n{secret}".encode("utf-8")
    sign = base64.b64encode(hmac.new(string_to_sign, digestmod=hashlib.sha256).digest()).decode(
        "utf-8"
    )
    payload["timestamp"] = timestamp
    payload["sign"] = sign
    return payload


def post_notifications(text: str) -> None:
    feishu = os.getenv("FEISHU_WEBHOOK_URL", "").strip()
    feishu_secret = os.getenv("FEISHU_BOT_SECRET", "").strip()
    if feishu:
        try:
            requests.post(feishu, json=signed_feishu_payload(text, feishu_secret), timeout=15).raise_for_status()
            print("Feishu notification sent.")
        except Exception as exc:
            print(f"Feishu notification failed: {exc}")

    wecom = os.getenv("WECOM_WEBHOOK_URL", "").strip()
    if wecom:
        try:
            requests.post(wecom, json={"msgtype": "text", "text": {"content": text}}, timeout=15).raise_for_status()
            print("WeCom notification sent.")
        except Exception as exc:
            print(f"WeCom notification failed: {exc}")


def main() -> None:
    status = os.getenv("JOB_STATUS", "")
    warnings = build_warnings()
    event_name = os.getenv("GITHUB_EVENT_NAME", "")
    schedule_cron = os.getenv("SCHEDULE_CRON", "")

    same_day_success = False
    if event_name == "schedule" and schedule_cron == FINAL_SCHEDULE_CRON and status != "success":
        same_day_success = has_same_day_successful_scheduled_run()

    decision = notification_decision(
        status=status,
        warnings=warnings,
        event_name=event_name,
        schedule_cron=schedule_cron,
        has_same_day_success=same_day_success,
    )
    if not decision.should_notify:
        print(f"Skip webhook notification: {decision.reason}.")
        return

    run_url = f"{os.getenv('SERVER_URL')}/{os.getenv('REPO')}/actions/runs/{os.getenv('RUN_ID')}"
    text = (
        f"[{decision.level}] Index T-1 sync {status}\n"
        f"Repo: {os.getenv('REPO')}\n"
        f"Reason: {decision.reason}\n"
        f"HSI latest: {os.getenv('HSI_LATEST', '')}\n"
        f"Warnings: {', '.join(warnings) if warnings else 'none'}\n"
        f"Run: {run_url}"
    )
    post_notifications(text)


if __name__ == "__main__":
    main()
