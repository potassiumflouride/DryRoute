from __future__ import annotations

import pytest

from loadtest.config import ConfigurationError, LoadConfig


def test_mixed_profile_requires_all_targets() -> None:
    with pytest.raises(ConfigurationError, match="geocode target URL"):
        LoadConfig(route_url="http://localhost:8000/route").validate()


def test_known_shared_service_is_rejected() -> None:
    with pytest.raises(ConfigurationError, match="shared third-party"):
        LoadConfig(profile="route", route_url="https://valhalla1.openstreetmap.de/route").validate()


def test_header_values_are_not_in_sanitized_output() -> None:
    config = LoadConfig(profile="route", route_url="http://localhost:8000/route", route_headers={"Authorization": "secret"})
    config.validate()
    sanitized = config.sanitized()
    assert sanitized["route_header_names"] == ["Authorization"]
    assert "secret" not in repr(sanitized)

