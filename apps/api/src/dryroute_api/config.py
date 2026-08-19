from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DRYROUTE_", env_file=".env")

    nea_api_key: str = ""
    onemap_api_key: str = ""
    maptiler_api_key: str = ""

    osrm_foot_url: str = "http://localhost:5001"
    osrm_bicycle_url: str = "http://localhost:5002"
    osrm_motorcycle_url: str = "http://localhost:5003"


settings = Settings()
