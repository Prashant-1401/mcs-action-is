from pydantic_settings import BaseSettings



class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mcsdb"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"
    secret_key: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    allowed_origins: str = "http://localhost:5173"
    api_key: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    admin_email: str = "admin@adroit.in"
    team_email: str = "team@adroit.in"
    wacrm_alert_url: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
