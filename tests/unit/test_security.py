"""
Unit tests for app/core/security.py.

Covers:
  - hash_password / verify_password (bcrypt cost=12)
  - generate_token (256-bit CSPRNG, hex, uniqueness)
  - hash_token (SHA-256 hex digest, determinism)
"""
from __future__ import annotations

import hashlib
import re

import pytest

from app.core.security import generate_token, hash_password, hash_token, verify_password


class TestHashPassword:
    def test_returns_bcrypt_12_prefix(self) -> None:
        h = hash_password("SecurePass1!")
        assert h.startswith("$2b$12$"), f"Expected bcrypt cost-12 hash, got: {h[:10]}"

    def test_different_salts_for_same_password(self) -> None:
        h1 = hash_password("SecurePass1!")
        h2 = hash_password("SecurePass1!")
        assert h1 != h2, "Two hashes of the same password should differ (different salts)"

    def test_long_password(self) -> None:
        # 60 chars -- well under bcrypt's 72-byte limit
        long_pw = "A" * 57 + "b1!"
        h = hash_password(long_pw)
        assert h.startswith("$2b$12$")

    def test_special_characters(self) -> None:
        h = hash_password("P@$$w0rd!#%^&*()")
        assert h.startswith("$2b$12$")


class TestVerifyPassword:
    def test_correct_password_returns_true(self) -> None:
        plain = "SecurePass1!"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_wrong_password_returns_false(self) -> None:
        hashed = hash_password("SecurePass1!")
        assert verify_password("WrongPass1!", hashed) is False

    def test_empty_password_against_hash_of_empty(self) -> None:
        hashed = hash_password("")
        assert verify_password("", hashed) is True

    def test_case_sensitive(self) -> None:
        hashed = hash_password("SecurePass1!")
        assert verify_password("securepass1!", hashed) is False


class TestGenerateToken:
    def test_returns_64_hex_chars(self) -> None:
        token = generate_token()
        assert len(token) == 64, f"Expected 64 hex chars, got {len(token)}"
        assert re.fullmatch(r"[0-9a-f]{64}", token), f"Not a lowercase hex string: {token}"

    def test_uniqueness_across_1000_tokens(self) -> None:
        tokens = {generate_token() for _ in range(1000)}
        assert len(tokens) == 1000, "Generated tokens are not all unique"

    def test_entropy_at_least_128_bits(self) -> None:
        # 64 hex chars == 32 bytes == 256 bits.  This check is structural.
        token = generate_token()
        assert len(bytes.fromhex(token)) == 32

    def test_uniqueness_across_10000_tokens(self) -> None:
        tokens = [generate_token() for _ in range(10_000)]
        # Every token must be at least 64 hex characters long (256-bit entropy).
        for token in tokens:
            assert len(token) >= 64, f"Token shorter than 64 chars: {token!r}"
        # All tokens must be unique - no duplicates allowed.
        unique_tokens = set(tokens)
        assert len(unique_tokens) == 10_000, (
            f"Collision detected: only {len(unique_tokens)} unique tokens out of 10,000"
        )


class TestHashToken:
    def test_returns_sha256_hex_of_token(self) -> None:
        token = "abc123"
        expected = hashlib.sha256(b"abc123").hexdigest()
        assert hash_token(token) == expected

    def test_deterministic(self) -> None:
        token = generate_token()
        assert hash_token(token) == hash_token(token)

    def test_different_inputs_produce_different_hashes(self) -> None:
        t1, t2 = generate_token(), generate_token()
        assert hash_token(t1) != hash_token(t2)

    def test_output_is_64_hex_chars(self) -> None:
        digest = hash_token("some_token_value")
        assert len(digest) == 64
        assert re.fullmatch(r"[0-9a-f]{64}", digest)
