"""
Application configuration loaded from environment variables.

All settings are defined here using Pydantic BaseSettings. The application
reads from environment variables or a .env file in the project root.
"""
from __future__ import annotations

from pydantic import EmailStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration object for the Lenis platform.

    All values are loaded from environment variables. A .env file in the
    project root is read automatically when present.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ------------------------------------------------------------------
    # Application
    # ------------------------------------------------------------------
    app_name: str = "Lenis"
    app_env: str = "development"  # "development" | "production"
    debug: bool = False

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    database_url: str = "sqlite+aiosqlite:///./lenis_dev.db"

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # ------------------------------------------------------------------
    # Celery
    # ------------------------------------------------------------------
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # ------------------------------------------------------------------
    # JWT / RS256 key pair
    # The values must be PEM-encoded strings with literal \n escape sequences
    # in the environment variable, or multiline values in the .env file.
    # ------------------------------------------------------------------
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    jwt_algorithm: str = "RS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7
    jwt_issuer: str = "lenis"
    jwt_audience: str = "lenis-api"


    # ------------------------------------------------------------------
    # SMTP / Email
    # ------------------------------------------------------------------
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from_address: str = "noreply@lenis.io"
    smtp_from_name: str = "Lenis Platform"
    smtp_tls: bool = False
    smtp_start_tls: bool = False

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------
    rate_limit_requests_per_minute: int = 10
    login_failure_max_attempts: int = 5
    login_failure_window_seconds: int = 600   # 10 minutes
    login_block_ttl_seconds: int = 900        # 15 minutes

    # ------------------------------------------------------------------
    # Frontend / CORS
    # ------------------------------------------------------------------
    frontend_origin: str = "http://localhost:5173"

    # ------------------------------------------------------------------
    # KYC / Dojah
    # ------------------------------------------------------------------
    use_dojah: bool = False
    dojah_app_id: str = ""
    dojah_secret_key: str = ""

    # ------------------------------------------------------------------
    # Countries API
    # ------------------------------------------------------------------
    rest_countries_api: str = "https://restcountries.com/v3.1"

    # ------------------------------------------------------------------
    # EVM RPC endpoints
    # ------------------------------------------------------------------
    ethereum_rpc_url: str = ""
    base_rpc_url: str = ""
    polygon_rpc_url: str = ""
    arbitrum_rpc_url: str = ""
    optimism_rpc_url: str = ""
    bsc_rpc_url: str = ""

    # ------------------------------------------------------------------
    # Testnet RPC endpoints (used when test_mode = True)
    # ------------------------------------------------------------------
    base_sepolia_rpc_url: str = ""
    polygon_mumbai_rpc_url: str = ""
    arbitrum_sepolia_rpc_url: str = ""
    optimism_sepolia_rpc_url: str = ""
    ethereum_sepolia_rpc_url: str = ""
    testnet_mode: bool = False

    # ------------------------------------------------------------------
    # Blockchain Indexer
    # ------------------------------------------------------------------
    blockchain_webhook_secret: str = ""
    indexer_polling_enabled: bool = False
    webhook_encryption_key: str = ""  # base64-encoded 32 bytes
    coingecko_api_key: str = ""

    # ------------------------------------------------------------------
    # ERC-20 contract addresses (mainnet defaults)
    # ------------------------------------------------------------------
    ethereum_usdc_contract: str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    ethereum_usdt_contract: str = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
    ethereum_dai_contract: str = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
    base_usdc_contract: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    base_usdt_contract: str = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"
    polygon_usdc_contract: str = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
    polygon_usdt_contract: str = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
    polygon_dai_contract: str = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"
    arbitrum_usdc_contract: str = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    arbitrum_usdt_contract: str = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
    arbitrum_dai_contract: str = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
    optimism_usdc_contract: str = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
    optimism_usdt_contract: str = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"
    optimism_dai_contract: str = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
    bsc_usdc_contract: str = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
    bsc_usdt_contract: str = "0x55d398326f99059fF775485246999027B3197955"

    # ------------------------------------------------------------------
    # File storage
    # ------------------------------------------------------------------
    upload_storage: str = "local"        # 'local' | 's3'
    upload_local_path: str = "./uploads"
    max_upload_size_mb: int = 10
    aws_s3_bucket: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

    # ------------------------------------------------------------------
    # Termii SMS / OTP
    # ------------------------------------------------------------------
    termii_api_key: str = ""
    termii_sender_id: str = "Lenis"
    termii_base_url: str = "https://api.ng.termii.com"

    # ------------------------------------------------------------------
    # Didit Automated KYC
    # ------------------------------------------------------------------
    didit_api_key: str = ""
    didit_workflow_id: str = "d4041518-0f19-4adf-81cf-3d3bfba3163e"
    didit_base_url: str = "https://verification.didit.me/v3"
    didit_callback_url: str = ""
    didit_webhook_secret_key: str = ""

    @field_validator("jwt_private_key", "jwt_public_key", mode="before")
    @classmethod
    def _normalise_pem(cls, value: str) -> str:
        """Replace literal \\n escape sequences with real newlines.

        Environment variables stored in .env files or shell exports often
        represent PEM keys with \\n instead of actual newlines. This
        validator normalises them so python-jose can parse the key.
        """
        if isinstance(value, str):
            return value.replace("\\n", "\n")
        return value


settings = Settings()
