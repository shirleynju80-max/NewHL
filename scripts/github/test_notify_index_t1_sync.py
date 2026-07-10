from notify_index_t1_sync import notification_decision


def test_early_scheduled_failure_is_deferred() -> None:
    decision = notification_decision(
        status="failure",
        warnings=[],
        event_name="schedule",
        schedule_cron="35 10 * * 1-5",
        has_same_day_success=False,
    )

    assert not decision.should_notify
    assert "deferred" in decision.reason


def test_final_scheduled_failure_is_suppressed_if_same_day_run_succeeded() -> None:
    decision = notification_decision(
        status="failure",
        warnings=[],
        event_name="schedule",
        schedule_cron="35 12 * * 1-5",
        has_same_day_success=True,
    )

    assert not decision.should_notify
    assert "same-day" in decision.reason


def test_final_scheduled_failure_alerts_without_same_day_success() -> None:
    decision = notification_decision(
        status="failure",
        warnings=[],
        event_name="schedule",
        schedule_cron="35 12 * * 1-5",
        has_same_day_success=False,
    )

    assert decision.should_notify
    assert decision.level == "ERROR"


def test_final_scheduled_warning_still_alerts() -> None:
    decision = notification_decision(
        status="success",
        warnings=["HSI stale"],
        event_name="schedule",
        schedule_cron="35 12 * * 1-5",
        has_same_day_success=True,
    )

    assert decision.should_notify
    assert decision.level == "WARN"


def test_manual_failure_alerts_immediately() -> None:
    decision = notification_decision(
        status="failure",
        warnings=[],
        event_name="workflow_dispatch",
        schedule_cron="",
        has_same_day_success=True,
    )

    assert decision.should_notify
    assert decision.level == "ERROR"
