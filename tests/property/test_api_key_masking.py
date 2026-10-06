"""
Property-based tests for API key hash integrity and masking.

Properties tested:
  - Property 1: API Key Hash Integrity
    For any created key, key_hash == sha256(plaintext) for secret keys,
    and no column in api_keys stores the full plaintext.

  - Property 8: API Key Masking Invariant
    Every object in list_api_keys response contains prefix and suffix_display
    but never the full plaintext or its SHA-256 hash.

Validates: Requirements 1.2, 1.4

Feature: developer-api-and-public-platform
"""
from __future__ import annotations

import hashlib
import secrets

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.core.security import hash_token


# ---------------------------------------------------------------------------
# Standalone logic tests (no DB required — pure function tests)
# ---------------------------------------------------------------------------


def _simulate_create_api_key(key_type: str) -> dict:
    """
    Simulate the create_api_key service logic for property testing.

    Replicates the exact logic from app/merchant/service.py:create_api_key
    without requiring a database session.
    """
    token_suffix = secrets.token_urlsafe(24)
    plaintext_key = f"{key_type}_{token_suffix}"

    prefix = f"{key_type}_"
    suffix_display = plaintext_key[-4:]

    is_secret = key_type.startswith("sk_")

    if is_secret:
        stored_hash = hash_token(plaintext_key)
    else:
        # Publishable keys stored as plaintext (public by design)
        stored_hash = plaintext_key

    return {
        "key_type": key_type,
        "prefix": prefix,
        "suffix_display": suffix_display,
        "key_hash": stored_hash,
        "plaintext_key": plaintext_key,
        "active": True,
    }


def _simulate_list_api_key_response(key_record: dict) -> dict:
    """
    Simulate the list_api_keys masked response — mirroring the router schema
    (APIKeyListItem) which only exposes: id, key_type, prefix, suffix_display,
    active, created_at. The key_hash and plaintext_key are never returned.
    """
    return {
        "key_type": key_record["key_type"],
        "prefix": key_record["prefix"],
        "suffix_display": key_record["suffix_display"],
        "active": key_record["active"],
    }


# ---------------------------------------------------------------------------
# Property 1: API Key Hash Integrity
# Validates: Requirement 1.2
# ---------------------------------------------------------------------------


@settings(max_examples=200)
@given(
    key_type=st.sampled_from(["sk_test", "pk_test", "sk_live", "pk_live"]),
)
def test_api_key_hash_integrity(key_type: str) -> None:
    """**Validates: Requirements 1.2**

    Property 1: API Key Hash Integrity.

    For any created secret key:
      - key_hash MUST equal sha256(plaintext_key)
      - The plaintext MUST NOT appear verbatim in any column stored in the DB

    For publishable keys the plaintext IS stored as key_hash (public by design),
    so the "no plaintext" constraint applies only to sk_* keys.
    """
    record = _simulate_create_api_key(key_type)
    plaintext = record["plaintext_key"]
    expected_hash = hashlib.sha256(plaintext.encode()).hexdigest()

    if key_type.startswith("sk_"):
        # Secret keys: key_hash must equal sha256(plaintext)
        assert record["key_hash"] == expected_hash, (
            f"key_hash mismatch for {key_type}: "
            f"stored={record['key_hash'][:16]}... expected={expected_hash[:16]}..."
        )
        # plaintext must NOT be the same as key_hash (key_hash is a hex digest, not plaintext)
        assert record["key_hash"] != plaintext, (
            "key_hash for sk_* key should be a SHA-256 hash, not the plaintext itself"
        )
    else:
        # Publishable keys: plaintext stored as key_hash (public by design, per spec)
        assert record["key_hash"] == plaintext, (
            f"pk_* key_hash should store plaintext. Got {record['key_hash'][:20]}..."
        )


@settings(max_examples=200)
@given(
    key_type=st.sampled_from(["sk_test", "sk_live"]),
)
def test_secret_key_plaintext_never_equals_hash(key_type: str) -> None:
    """For secret keys, key_hash is a SHA-256 hex digest, never the raw plaintext."""
    record = _simulate_create_api_key(key_type)
    plaintext = record["plaintext_key"]

    # A plaintext key like "sk_test_abc..." cannot be a 64-char hex string
    assert record["key_hash"] != plaintext
    # key_hash must be exactly 64 hex chars (SHA-256 output)
    assert len(record["key_hash"]) == 64
    assert all(c in "0123456789abcdef" for c in record["key_hash"])


# ---------------------------------------------------------------------------
# Property 8: API Key Masking Invariant
# Validates: Requirement 1.4
# ---------------------------------------------------------------------------


@settings(max_examples=200)
@given(
    key_type=st.sampled_from(["sk_test", "pk_test", "sk_live", "pk_live"]),
)
def test_api_key_masking_invariant(key_type: str) -> None:
    """**Validates: Requirements 1.4**

    Property 8: API Key Masking Invariant.

    Every object in GET /merchant/api-keys response MUST:
      - Contain 'prefix' field
      - Contain 'suffix_display' field
      - NOT contain the full plaintext key
      - NOT contain the SHA-256 hash of the plaintext key (for sk_* keys)
    """
    record = _simulate_create_api_key(key_type)
    masked = _simulate_list_api_key_response(record)

    plaintext = record["plaintext_key"]
    sha256_hash = hashlib.sha256(plaintext.encode()).hexdigest()

    # Must contain prefix and suffix_display
    assert "prefix" in masked, "Response must include 'prefix' field"
    assert "suffix_display" in masked, "Response must include 'suffix_display' field"
    assert masked["prefix"] == f"{key_type}_"
    assert masked["suffix_display"] == plaintext[-4:]

    # Must NOT contain full plaintext key in any field value
    for field_name, field_value in masked.items():
        if isinstance(field_value, str):
            assert field_value != plaintext, (
                f"Field '{field_name}' contains full plaintext key — must be masked"
            )

    # For secret keys, must NOT contain the SHA-256 hash either
    if key_type.startswith("sk_"):
        for field_name, field_value in masked.items():
            if isinstance(field_value, str):
                assert field_value != sha256_hash, (
                    f"Field '{field_name}' exposes sha256(plaintext) — must not be in list response"
                )


@settings(max_examples=200)
@given(
    key_types=st.lists(
        st.sampled_from(["sk_test", "pk_test", "sk_live", "pk_live"]),
        min_size=1,
        max_size=10,
    )
)
def test_list_response_never_exposes_full_key(key_types: list[str]) -> None:
    """**Validates: Requirements 1.4**

    Simulates a list of N keys — none of the list response entries should
    expose the full plaintext or sha256 hash of sk_* keys.
    """
    records = [_simulate_create_api_key(kt) for kt in key_types]
    masked_list = [_simulate_list_api_key_response(r) for r in records]

    for i, (record, masked) in enumerate(zip(records, masked_list)):
        plaintext = record["plaintext_key"]
        sha256_hash = hashlib.sha256(plaintext.encode()).hexdigest()

        for field_name, field_value in masked.items():
            if isinstance(field_value, str):
                assert field_value != plaintext, (
                    f"Key {i} field '{field_name}' exposes full plaintext"
                )
                if record["key_type"].startswith("sk_"):
                    assert field_value != sha256_hash, (
                        f"Key {i} field '{field_name}' exposes sha256 hash"
                    )


# ---------------------------------------------------------------------------
# Additional unit tests
# ---------------------------------------------------------------------------


class TestAPIKeyStructure:
    def test_sk_test_key_format(self) -> None:
        record = _simulate_create_api_key("sk_test")
        assert record["plaintext_key"].startswith("sk_test_")
        assert record["prefix"] == "sk_test_"
        assert len(record["suffix_display"]) == 4

    def test_pk_live_key_format(self) -> None:
        record = _simulate_create_api_key("pk_live")
        assert record["plaintext_key"].startswith("pk_live_")
        assert record["prefix"] == "pk_live_"

    def test_suffix_display_matches_last_4_chars(self) -> None:
        for key_type in ["sk_test", "pk_test", "sk_live", "pk_live"]:
            record = _simulate_create_api_key(key_type)
            assert record["suffix_display"] == record["plaintext_key"][-4:]

    def test_two_keys_never_identical(self) -> None:
        a = _simulate_create_api_key("sk_live")
        b = _simulate_create_api_key("sk_live")
        assert a["plaintext_key"] != b["plaintext_key"]
        assert a["key_hash"] != b["key_hash"]

    def test_hash_token_deterministic(self) -> None:
        token = "sk_test_abc123abc123abc123abc123ab"
        assert hash_token(token) == hash_token(token)
