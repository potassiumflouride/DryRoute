from __future__ import annotations

import asyncio
import json
import sys

from loadtest.config import ConfigurationError, load_config
from loadtest.metrics import Metrics, evaluate, write_reports
from loadtest.scheduler import LoadScheduler, run_preflight
from loadtest.workloads import Workloads


async def _run(argv: list[str] | None = None) -> int:
    config = load_config(argv)
    print("Targets and load configuration:")
    print(json.dumps(config.sanitized(), indent=2))
    metrics = Metrics()
    async with Workloads(config, metrics) as workloads:
        elapsed = await run_preflight(config, workloads) if config.preflight else await LoadScheduler(config, workloads).run()

    summary = metrics.summary(elapsed)
    failures = evaluate(summary, config)
    json_path, html_path = write_reports(metrics, config, elapsed, failures)
    print(json.dumps(summary, indent=2))
    print(f"JSON report: {json_path}")
    print(f"HTML report: {html_path}")
    if failures:
        print("Threshold failures:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("All configured thresholds passed.")
    return 0


def main() -> None:
    try:
        raise SystemExit(asyncio.run(_run()))
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
    except KeyboardInterrupt:
        print("Load test interrupted.", file=sys.stderr)
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()

