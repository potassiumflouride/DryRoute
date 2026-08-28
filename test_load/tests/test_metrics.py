import json

from loadtest.config import LoadConfig
from loadtest.metrics import Metrics, RequestSample, evaluate, percentile, write_reports


def test_percentile_interpolates() -> None:
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.5) == 2.5
    assert percentile([], 0.95) is None


def test_thresholds_fail_at_error_limit() -> None:
    metrics = Metrics()
    for success in [True] * 99 + [False]:
        metrics.record(RequestSample("route", 0.1, success, 200 if success else 500, 10, None if success else "HTTP 500"))
    config = LoadConfig(profile="route", route_url="http://localhost:8000/route")
    failures = evaluate(metrics.summary(1.0), config)
    assert any("global error rate" in failure for failure in failures)
    assert any("route error rate" in failure for failure in failures)


def test_p95_threshold_failure() -> None:
    metrics = Metrics()
    metrics.record(RequestSample("tiles", 0.6, True, 200, 10))
    config = LoadConfig(profile="tiles", tiles_base_url="http://localhost:8081")
    assert evaluate(metrics.summary(1.0), config) == ["tiles p95 0.600s exceeds 0.500s"]


def test_reports_are_standalone_and_sanitized(tmp_path) -> None:
    metrics = Metrics()
    metrics.record(RequestSample("route", 0.1, True, 200, 100))
    config = LoadConfig(
        profile="route",
        route_url="http://localhost:8000/route",
        route_headers={"Authorization": "secret"},
    )
    json_path, html_path = write_reports(metrics, config, 1.0, [], results_dir=tmp_path)
    payload = json.loads(json_path.read_text())
    assert payload["passed"] is True
    assert "secret" not in json_path.read_text()
    assert "secret" not in html_path.read_text()
    assert "<table>" in html_path.read_text()
