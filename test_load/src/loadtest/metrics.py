from __future__ import annotations

import html
import json
import math
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from loadtest.config import LoadConfig


@dataclass(frozen=True)
class RequestSample:
    service: str
    elapsed_seconds: float
    success: bool
    status_code: int | None
    response_bytes: int
    error: str | None = None


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


class Metrics:
    def __init__(self) -> None:
        self.samples: list[RequestSample] = []

    def record(self, sample: RequestSample) -> None:
        self.samples.append(sample)

    def summary(self, elapsed_seconds: float) -> dict[str, Any]:
        groups: dict[str, list[RequestSample]] = defaultdict(list)
        for sample in self.samples:
            groups[sample.service].append(sample)
        return {
            service: self._group_summary(samples, elapsed_seconds)
            for service, samples in sorted(groups.items())
        }

    @staticmethod
    def _group_summary(samples: list[RequestSample], elapsed_seconds: float) -> dict[str, Any]:
        success_count = sum(sample.success for sample in samples)
        latencies = [sample.elapsed_seconds for sample in samples]
        statuses = Counter(str(sample.status_code) if sample.status_code is not None else "none" for sample in samples)
        errors = Counter(sample.error for sample in samples if sample.error)
        return {
            "requests": len(samples),
            "successes": success_count,
            "failures": len(samples) - success_count,
            "error_rate": (len(samples) - success_count) / len(samples) if samples else 1.0,
            "requests_per_second": len(samples) / elapsed_seconds if elapsed_seconds > 0 else 0.0,
            "response_bytes": sum(sample.response_bytes for sample in samples),
            "latency_seconds": {
                "p50": percentile(latencies, 0.50),
                "p90": percentile(latencies, 0.90),
                "p95": percentile(latencies, 0.95),
                "p99": percentile(latencies, 0.99),
                "max": max(latencies, default=None),
            },
            "status_codes": dict(statuses),
            "errors": dict(errors.most_common(10)),
        }


def evaluate(summary: dict[str, Any], config: LoadConfig) -> list[str]:
    failures: list[str] = []
    p95_limits = {
        "route": config.thresholds.route_p95_seconds,
        "geocode": config.thresholds.geocode_p95_seconds,
        "tiles": config.thresholds.tiles_p95_seconds,
    }
    total_requests = sum(group["requests"] for group in summary.values())
    total_failures = sum(group["failures"] for group in summary.values())
    if total_requests == 0:
        return ["no requests were recorded"]
    global_error_rate = total_failures / total_requests
    if global_error_rate >= config.thresholds.max_error_rate:
        failures.append(
            f"global error rate {global_error_rate:.2%} must be below {config.thresholds.max_error_rate:.2%}"
        )
    for service in config.enabled_services:
        group = summary.get(service)
        if group is None or group["requests"] == 0:
            failures.append(f"{service} recorded no requests")
            continue
        if group["error_rate"] >= config.thresholds.max_error_rate:
            failures.append(
                f"{service} error rate {group['error_rate']:.2%} must be below {config.thresholds.max_error_rate:.2%}"
            )
        p95 = group["latency_seconds"]["p95"]
        if p95 is not None and p95 > p95_limits[service]:
            failures.append(f"{service} p95 {p95:.3f}s exceeds {p95_limits[service]:.3f}s")
    return failures


def write_reports(
    metrics: Metrics,
    config: LoadConfig,
    elapsed_seconds: float,
    threshold_failures: list[str],
    results_dir: Path | None = None,
) -> tuple[Path, Path]:
    if results_dir is None:
        project_dir = Path(__file__).resolve().parents[2]
        results_dir = project_dir / "results"
    results_dir.mkdir(exist_ok=True)
    stamp = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
    summary = metrics.summary(elapsed_seconds)
    payload = {
        "generated_at": datetime.now(tz=UTC).isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "passed": not threshold_failures,
        "threshold_failures": threshold_failures,
        "config": config.sanitized(),
        "thresholds": asdict(config.thresholds),
        "services": summary,
    }
    json_path = results_dir / f"load-test-{stamp}.json"
    html_path = results_dir / f"load-test-{stamp}.html"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    html_path.write_text(_html_report(payload), encoding="utf-8")
    return json_path, html_path


def _html_report(payload: dict[str, Any]) -> str:
    status = "PASS" if payload["passed"] else "FAIL"
    rows = []
    for service, group in payload["services"].items():
        latency = group["latency_seconds"]
        rows.append(
            "<tr>"
            f"<td>{html.escape(service)}</td><td>{group['requests']}</td>"
            f"<td>{group['requests_per_second']:.2f}</td><td>{group['error_rate']:.2%}</td>"
            f"<td>{latency['p50']:.3f}</td><td>{latency['p95']:.3f}</td><td>{latency['p99']:.3f}</td>"
            "</tr>"
        )
    failures = "".join(f"<li>{html.escape(item)}</li>" for item in payload["threshold_failures"])
    config_json = html.escape(json.dumps(payload["config"], indent=2))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DryRoute load test {status}</title>
<style>
body{{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f4f7f5;color:#17211b}}
main{{max-width:1050px;margin:auto;padding:40px 20px}}h1{{margin-bottom:8px}}.status{{font-weight:800;color:{'#167342' if payload['passed'] else '#b42318'}}}
.card{{background:white;border:1px solid #dce5df;border-radius:12px;padding:20px;margin:20px 0;overflow:auto}}
table{{width:100%;border-collapse:collapse;min-width:680px}}th,td{{padding:10px;text-align:right;border-bottom:1px solid #e5ebe7}}
th:first-child,td:first-child{{text-align:left}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}
</style></head><body><main><h1>DryRoute load test</h1><div class="status">{status}</div>
<p>{payload['elapsed_seconds']:.1f} seconds · generated {html.escape(payload['generated_at'])}</p>
<section class="card"><h2>Service results</h2><table><thead><tr><th>Service</th><th>Requests</th><th>RPS</th><th>Errors</th><th>p50 (s)</th><th>p95 (s)</th><th>p99 (s)</th></tr></thead><tbody>{''.join(rows)}</tbody></table></section>
<section class="card"><h2>Threshold findings</h2><ul>{failures or '<li>All configured thresholds passed.</li>'}</ul></section>
<section class="card"><h2>Sanitized configuration</h2><pre>{config_json}</pre></section>
</main></body></html>"""
