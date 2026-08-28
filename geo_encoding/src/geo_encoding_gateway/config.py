from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GEO_ENCODING_", env_file=".env")

    onemap_email: str = ""
    onemap_password: str = ""

    onemap_base_url: str = "https://www.onemap.gov.sg"
    onemap_token_url: str = "https://www.onemap.gov.sg/api/auth/post/getToken"

    # Refresh proactively this many seconds before expiry_timestamp.
    token_refresh_buffer_seconds: int = 3600
    # Background refresh loop poll interval.
    token_refresh_check_interval_seconds: int = 300

    rate_limit_max_calls: int = 250
    rate_limit_window_seconds: float = 60.0
    rate_limit_max_wait_seconds: float = 5.0

    upstream_timeout_seconds: float = 10.0
    onemap_retry_max_attempts: int = 5
    onemap_retry_backoff_seconds: float = 2.0


settings = Settings()
