from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DRYROUTE_", env_file=".env")

    nea_api_key: str = ""
    onemap_api_key: str = ""
    maptiler_api_key: str = ""

    valhalla_url: str = "https://valhalla1.openstreetmap.de"
    rain_avoidance_enabled: bool = True
    rain_alpha_threshold: int = 40


settings = Settings()
