"""
Unit tests for app/core/tokens.py.

Tests use a real RSA-2048 key pair generated at module import time so they
are self-contained and require no running Redis.  Blocklist tests use a
lightweight mock of the async Redis client.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt

from app.core import tokens as tok


# ---------------------------------------------------------------------------
# Helpers: generate a temporary RSA key pair for tests
# ---------------------------------------------------------------------------

def _generate_test_keypair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return private_pem, public_pem


_PRIVATE_PEM, _PUBLIC_PEM = _generate_test_keypair()


# ---------------------------------------------------------------------------
# Fixtures: patch settings with test keys
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def patch_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace JWT key settings with freshly generated test keys."""
    monkeypatch.setattr("app.core.tokens.settings.jwt_private_key", _PRIVATE_PEM)
    monkeypatch.setattr("app.core.tokens.settings.jwt_public_key", _PUBLIC_PEM)
    monkeypatch.setattr("app.core.tokens.settings.jwt_access_token_expire_minutes", 15)


# ---------------------------------------------------------------------------
# create_access_token
# ---------------------------------------------------------------------------

class TestCreateAccessToken:
    def test_is_valid_rs256_jwt(self) -> None:
        token = tok.create_access_token({"sub": "user-123", "role": "developer"})
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "RS256"
        assert header["typ"] == "JWT"

    def test_payload_contains_required_standard_claims(self) -> None:
        token = tok.create_access_token({"sub": "user-123", "email": "a@b.com", "role": "merchant"})
        claims = jwt.decode(token, _PUBLIC_PEM, algorithms=["RS256"],
                            issuer="lenis", audience="lenis-api")
        assert claims["iss"] == "lenis"
        assert claims["aud"] == "lenis-api"
        assert "exp" in claims
        assert "iat" in claims
        assert "jti" in claims
        # Ensure jti is a valid UUID4
        parsed_jti = uuid.UUID(claims["jti"])
        assert parsed_jti.version == 4

    def test_custom_payload_fields_preserved(self) -> None:
        token = tok.create_access_token({"sub": "u1", "email": "x@y.com", "role": "admin"})
        claims = jwt.decode(token, _PUBLIC_PEM, algorithms=["RS256"],
                            issuer="lenis", audience="lenis-api")
        assert claims["sub"] == "u1"
        assert claims["email"] == "x@y.com"
        assert claims["role"] == "admin"

    def test_expiry_is_approximately_15_minutes(self) -> None:
        before = datetime.now(tz=timezone.utc)
        token = tok.create_access_token({"sub": "u1"})
        claims = jwt.decode(token, _PUBLIC_PEM, algorithms=["RS256"],
                            issuer="lenis", audience="lenis-api")
        exp = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
        delta = exp - before
        # Allow 5-second tolerance around the expected 15 minutes
        assert timedelta(minutes=14, seconds=55) <= delta <= timedelta(minutes=15, seconds=5)

    def test_unique_jti_each_call(self) -> None:
        tokens = [tok.create_access_token({"sub": "u1"}) for _ in range(50)]
        jtis = {
            jwt.decode(t, _PUBLIC_PEM, algorithms=["RS256"],
                       issuer="lenis", audience="lenis-api")["jti"]
            for t in tokens
        }
        assert len(jtis) == 50, "Each token should have a unique JTI"


# ---------------------------------------------------------------------------
# decode_access_token
# ---------------------------------------------------------------------------

class TestDecodeAccessToken:
    def test_valid_token_returns_claims(self) -> None:
        token = tok.create_access_token({"sub": "u99", "role": "developer"})
        claims = tok.decode_access_token(token)
        assert claims["sub"] == "u99"
        assert claims["iss"] == "lenis"
        assert claims["aud"] == "lenis-api"

    def test_rejects_token_signed_with_wrong_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # Create token with one key pair, then try to verify with a different public key
        other_priv, other_pub = _generate_test_keypair()
        token = jwt.encode(
            {"sub": "u1", "iss": "lenis", "aud": "lenis-api",
             "exp": int(time.time()) + 900, "jti": str(uuid.uuid4())},
            other_priv, algorithm="RS256",
        )
        # decode_access_token uses _PUBLIC_PEM (from monkeypatched settings)
        with pytest.raises(tok.JWTError):
            tok.decode_access_token(token)

    def test_rejects_expired_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("app.core.tokens.settings.jwt_access_token_expire_minutes", -1)
        token = tok.create_access_token({"sub": "u1"})
        with pytest.raises(tok.JWTError):
            tok.decode_access_token(token)

    def test_rejects_wrong_issuer(self) -> None:
        payload = {
            "sub": "u1", "iss": "evil", "aud": "lenis-api",
            "exp": int(time.time()) + 900, "jti": str(uuid.uuid4()),
        }
        token = jwt.encode(payload, _PRIVATE_PEM, algorithm="RS256")
        with pytest.raises(tok.JWTError):
            tok.decode_access_token(token)

    def test_rejects_wrong_audience(self) -> None:
        payload = {
            "sub": "u1", "iss": "lenis", "aud": "wrong-audience",
            "exp": int(time.time()) + 900, "jti": str(uuid.uuid4()),
        }
        token = jwt.encode(payload, _PRIVATE_PEM, algorithm="RS256")
        with pytest.raises(tok.JWTError):
            tok.decode_access_token(token)

    def test_rejects_tampered_token(self) -> None:
        token = tok.create_access_token({"sub": "u1"})
        # Flip a character in the payload segment
        parts = token.split(".")
        tampered_payload = parts[1][:-2] + ("AA" if parts[1][-2:] != "AA" else "BB")
        tampered = ".".join([parts[0], tampered_payload, parts[2]])
        with pytest.raises(tok.JWTError):
            tok.decode_access_token(tampered)


# ---------------------------------------------------------------------------
# blocklist_token / is_token_blocklisted
# ---------------------------------------------------------------------------

class TestBlocklistToken:
    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        r = MagicMock()
        r.set = AsyncMock(return_value=True)
        r.get = AsyncMock(return_value=None)
        return r

    @pytest.mark.asyncio
    async def test_sets_key_with_ttl(self, mock_redis: MagicMock) -> None:
        await tok.blocklist_token(mock_redis, "test-jti", 900)
        mock_redis.set.assert_called_once_with("blocklist:jti:test-jti", "1", ex=900)

    @pytest.mark.asyncio
    async def test_noop_when_ttl_zero_or_negative(self, mock_redis: MagicMock) -> None:
        await tok.blocklist_token(mock_redis, "test-jti", 0)
        mock_redis.set.assert_not_called()

        await tok.blocklist_token(mock_redis, "test-jti", -5)
        mock_redis.set.assert_not_called()

    @pytest.mark.asyncio
    async def test_key_format(self, mock_redis: MagicMock) -> None:
        jti = str(uuid.uuid4())
        await tok.blocklist_token(mock_redis, jti, 60)
        call_args = mock_redis.set.call_args
        assert call_args[0][0] == f"blocklist:jti:{jti}"


class TestIsTokenBlocklisted:
    @pytest.fixture
    def redis_with_key(self) -> MagicMock:
        r = MagicMock()
        r.get = AsyncMock(return_value="1")
        return r

    @pytest.fixture
    def redis_without_key(self) -> MagicMock:
        r = MagicMock()
        r.get = AsyncMock(return_value=None)
        return r

    @pytest.mark.asyncio
    async def test_returns_true_when_key_exists(self, redis_with_key: MagicMock) -> None:
        result = await tok.is_token_blocklisted(redis_with_key, "some-jti")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_key_absent(self, redis_without_key: MagicMock) -> None:
        result = await tok.is_token_blocklisted(redis_without_key, "some-jti")
        assert result is False

    @pytest.mark.asyncio
    async def test_queries_correct_key(self, redis_without_key: MagicMock) -> None:
        jti = str(uuid.uuid4())
        await tok.is_token_blocklisted(redis_without_key, jti)
        redis_without_key.get.assert_called_once_with(f"blocklist:jti:{jti}")
