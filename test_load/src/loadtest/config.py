from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from dotenv import load_dotenv

Profile = Literal["mixed", "route", "geocode", "tiles"]
GeocodeStyle = Literal["backend", "onemap-gateway"]

KNOWN_SHARED_HOSTS = {"valhalla1.openstreetmap.de", "onemap.gov.sg", "www.onemap.gov.sg"}


class ConfigurationError(ValueError):
    pass


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return default if raw is None else float(raw)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return default if raw is None else int(raw)


def _headers(name: str) -> dict[str, str]:
    raw = os.getenv(name, "{}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigurationError(f"{name} must be a JSON object") from exc
    if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
        raise ConfigurationError(f"{name} must contain only string keys and values")
    return parsed


@dataclass(frozen=True)
class Thresholds:
    max_error_rate: float = 0.01
    route_p95_seconds: float = 3.0
    geocode_p95_seconds: float = 2.0
    tiles_p95_seconds: float = 0.5


@dataclass(frozen=True)
class LoadConfig:
    profile: Profile = "mixed"
    duration_seconds: float = 300.0
    max_users: int = 50
    think_time_min_seconds: float = 1.0
    think_time_max_seconds: float = 3.0
    tiles_per_view: int = 8
    request_timeout_seconds: float = 15.0
    random_seed: int = 20260827
    route_url: str | None = None
    geocode_url: str | None = None
    geocode_style: GeocodeStyle = "backend"
    tiles_base_url: str | None = None
    tiles_archive: str = "dryroute"
    tiles_path_template: str = "/{archive}/{z}/{x}/{y}.mvt"
    route_headers: dict[str, str] = field(default_factory=dict)
    geocode_headers: dict[str, str] = field(default_factory=dict)
    tiles_headers: dict[str, str] = field(default_factory=dict)
    thresholds: Thresholds = field(default_factory=Thresholds)
    allow_third_party: bool = False
    preflight: bool = False

    @property
    def enabled_services(self) -> tuple[str, ...]:
        return ("route", "geocode", "tiles") if self.profile == "mixed" else (self.profile,)

    def sanitized(self) -> dict[str, object]:
        return {
            "profile": self.profile,
            "duration_seconds": self.duration_seconds,
            "max_users": self.max_users,
            "route_url": self.route_url,
            "geocode_url": self.geocode_url,
            "geocode_style": self.geocode_style,
            "tiles_base_url": self.tiles_base_url,
            "tiles_archive": self.tiles_archive,
            "route_header_names": sorted(self.route_headers),
            "geocode_header_names": sorted(self.geocode_headers),
            "tiles_header_names": sorted(self.tiles_headers),
            "preflight": self.preflight,
        }

    def validate(self) -> None:
        if self.duration_seconds <= 0:
            raise ConfigurationError("duration must be greater than zero")
        if self.max_users < 1:
            raise ConfigurationError("max users must be at least one")
        if self.think_time_min_seconds < 0 or self.think_time_max_seconds < self.think_time_min_seconds:
            raise ConfigurationError("think time must be non-negative and max must be at least min")
        if self.tiles_per_view < 1:
            raise ConfigurationError("tiles per view must be at least one")
        if not 0 <= self.thresholds.max_error_rate < 1:
            raise ConfigurationError("max error rate must be between zero and one")

        urls = {
            "route": self.route_url,
            "geocode": self.geocode_url,
            "tiles": self.tiles_base_url,
        }
        for service in self.enabled_services:
            url = urls[service]
            if not url:
                raise ConfigurationError(f"{service} target URL is required for profile {self.profile!r}")
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ConfigurationError(f"{service} target must be an absolute HTTP(S) URL")
            if parsed.hostname in KNOWN_SHARED_HOSTS and not self.allow_third_party:
                raise ConfigurationError(
                    f"refusing to load test shared third-party host {parsed.hostname}; "
                    "use --allow-third-party only when explicitly authorized"
                )
        required_fields = {"archive", "z", "x", "y"}
        if "tiles" in self.enabled_services and not all(f"{{{name}}}" in self.tiles_path_template for name in required_fields):
            raise ConfigurationError("tile path template must contain {archive}, {z}, {x}, and {y}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Load test DryRoute services with up to 50 concurrent users.")
    parser.add_argument("--profile", choices=("mixed", "route", "geocode", "tiles"))
    parser.add_argument("--duration", type=float, help="Test duration in seconds (default: 300).")
    parser.add_argument("--max-users", type=int, help="Peak virtual users (default: 50).")
    parser.add_argument("--route-url")
    parser.add_argument("--geocode-url")
    parser.add_argument("--geocode-style", choices=("backend", "onemap-gateway"))
    parser.add_argument("--tiles-base-url")
    parser.add_argument("--allow-third-party", action="store_true")
    parser.add_argument("--preflight", action="store_true", help="Send one safe validation workflow instead of load.")
    return parser


def load_config(argv: list[str] | None = None) -> LoadConfig:
    project_dir = Path(__file__).resolve().parents[2]
    load_dotenv(project_dir / ".env")
    args = _parser().parse_args(argv)

    profile = args.profile or os.getenv("LOAD_PROFILE", "mixed")
    if profile not in {"mixed", "route", "geocode", "tiles"}:
        raise ConfigurationError(f"unsupported profile: {profile}")
    geocode_style = args.geocode_style or os.getenv("LOAD_GEOCODE_STYLE", "backend")
    if geocode_style not in {"backend", "onemap-gateway"}:
        raise ConfigurationError(f"unsupported geocode style: {geocode_style}")

    config = LoadConfig(
        profile=profile,  # type: ignore[arg-type]
        duration_seconds=args.duration if args.duration is not None else _env_float("LOAD_DURATION_SECONDS", 300.0),
        max_users=args.max_users if args.max_users is not None else _env_int("LOAD_MAX_USERS", 50),
        think_time_min_seconds=_env_float("LOAD_THINK_TIME_MIN_SECONDS", 1.0),
        think_time_max_seconds=_env_float("LOAD_THINK_TIME_MAX_SECONDS", 3.0),
        tiles_per_view=_env_int("LOAD_TILES_PER_VIEW", 8),
        request_timeout_seconds=_env_float("LOAD_REQUEST_TIMEOUT_SECONDS", 15.0),
        random_seed=_env_int("LOAD_RANDOM_SEED", 20260827),
        route_url=args.route_url or os.getenv("LOAD_ROUTE_URL"),
        geocode_url=args.geocode_url or os.getenv("LOAD_GEOCODE_URL"),
        geocode_style=geocode_style,  # type: ignore[arg-type]
        tiles_base_url=args.tiles_base_url or os.getenv("LOAD_TILES_BASE_URL"),
        tiles_archive=os.getenv("LOAD_TILES_ARCHIVE", "dryroute"),
        tiles_path_template=os.getenv("LOAD_TILES_PATH_TEMPLATE", "/{archive}/{z}/{x}/{y}.mvt"),
        route_headers=_headers("LOAD_ROUTE_HEADERS_JSON"),
        geocode_headers=_headers("LOAD_GEOCODE_HEADERS_JSON"),
        tiles_headers=_headers("LOAD_TILES_HEADERS_JSON"),
        thresholds=Thresholds(
            max_error_rate=_env_float("LOAD_MAX_ERROR_RATE", 0.01),
            route_p95_seconds=_env_float("LOAD_ROUTE_P95_SECONDS", 3.0),
            geocode_p95_seconds=_env_float("LOAD_GEOCODE_P95_SECONDS", 2.0),
            tiles_p95_seconds=_env_float("LOAD_TILES_P95_SECONDS", 0.5),
        ),
        allow_third_party=args.allow_third_party,
        preflight=args.preflight,
    )
    config.validate()
    return config
