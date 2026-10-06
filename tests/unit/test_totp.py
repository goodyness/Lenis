"""
Unit tests for app/core/totp.py (RFC 6238 TOTP).
"""
from __future__ import annotations

import time
import pytest
from app.core.totp import (
    _compute_totp_code,
    generate_totp_qr_data_url,
    generate_totp_secret,
    generate_totp_uri,
    verify_totp_code,
)


class TestTOTP:
    def test_generate_secret_format(self):
        secret = generate_totp_secret()
        assert len(secret) == 32
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in secret)

    def test_generate_uri(self):
        secret = "JBSWY3DPEHPK3PXP"
        email = "user@example.com"
        uri = generate_totp_uri(secret, email, issuer="Lenis")
        assert uri.startswith("otpauth://totp/Lenis:user%40example.com?secret=JBSWY3DPEHPK3PXP")
        assert "issuer=Lenis" in uri

    def test_generate_qr_data_url(self):
        uri = "otpauth://totp/Lenis:test@example.com?secret=JBSWY3DPEHPK3PXP"
        qr_url = generate_totp_qr_data_url(uri)
        assert qr_url.startswith("data:image/png;base64,")

    def test_verify_valid_totp_code(self):
        secret = generate_totp_secret()
        current_step = int(time.time() // 30)
        code = _compute_totp_code(secret, current_step)
        assert verify_totp_code(secret, code) is True

    def test_verify_drift_window(self):
        secret = generate_totp_secret()
        current_step = int(time.time() // 30)
        past_code = _compute_totp_code(secret, current_step - 1)
        future_code = _compute_totp_code(secret, current_step + 1)
        far_past_code = _compute_totp_code(secret, current_step - 5)

        assert verify_totp_code(secret, past_code, valid_window=1) is True
        assert verify_totp_code(secret, future_code, valid_window=1) is True
        assert verify_totp_code(secret, far_past_code, valid_window=1) is False

    def test_invalid_code_rejected(self):
        secret = generate_totp_secret()
        assert verify_totp_code(secret, "000000") is False
        assert verify_totp_code(secret, "abcdef") is False
        assert verify_totp_code(secret, "") is False
        assert verify_totp_code("", "123456") is False
