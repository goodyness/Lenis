"""
RFC 6238 Time-Based One-Time Password (TOTP) utility for Lenis.

Provides standard TOTP secret generation, QR code image generation (data URL),
and code verification compatible with Google Authenticator, Microsoft
Authenticator, Authy, and 1Password.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import os
import struct
import time
from urllib.parse import quote

import qrcode


def generate_totp_secret(length: int = 32) -> str:
    """Generate a cryptographically secure Base32 secret key."""
    base32_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    random_bytes = os.urandom(length)
    return "".join(base32_chars[b % 32] for b in random_bytes)


def generate_totp_uri(secret: str, email: str, issuer: str = "Lenis") -> str:
    """Build the standard otpauth:// URI for authenticator applications."""
    encoded_issuer = quote(issuer)
    encoded_email = quote(email)
    return f"otpauth://totp/{encoded_issuer}:{encoded_email}?secret={secret}&issuer={encoded_issuer}&algorithm=SHA1&digits=6&period=30"


def generate_totp_qr_data_url(otpauth_uri: str) -> str:
    """Generate a base64 PNG data URL of the QR code for scanning."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=6,
        border=2,
    )
    qr.add_data(otpauth_uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"


def _compute_totp_code(secret: str, time_step: int, digits: int = 6) -> str:
    """Compute 6-digit TOTP code for a given time step using RFC 6238 / RFC 4226."""
    clean_secret = secret.strip().replace(" ", "").upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding:
        clean_secret += "=" * (8 - missing_padding)

    key = base64.b32decode(clean_secret, casefold=True)
    msg = struct.pack(">Q", time_step)
    digest = hmac.new(key, msg, hashlib.sha1).digest()

    offset = digest[-1] & 0x0F
    binary_val = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    code = binary_val % (10**digits)
    return str(code).zfill(digits)


def verify_totp_code(secret: str, code: str, valid_window: int = 1, interval: int = 30) -> bool:
    """Verify a 6-digit TOTP code against a secret key with clock drift tolerance."""
    if not secret or not code:
        return False

    clean_code = code.strip().replace(" ", "").replace("-", "")
    if not clean_code.isdigit() or len(clean_code) != 6:
        return False

    current_time_step = int(time.time() // interval)

    for offset in range(-valid_window, valid_window + 1):
        step = current_time_step + offset
        try:
            expected_code = _compute_totp_code(secret, step, digits=6)
            if hmac.compare_digest(expected_code, clean_code):
                return True
        except Exception:
            continue

    return False
