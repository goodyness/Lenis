"""
Termii SMS and OTP verification client for the Lenis platform.

This module provides async helpers to send SMS messages and OTP tokens
to merchant phone numbers using the Termii REST API.
"""
from __future__ import annotations

import logging
import random
import re
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def generate_numeric_otp(length: int = 6) -> str:
    """Generate a cryptographically suitable random numeric OTP string."""
    digits = [str(random.SystemRandom().randint(0, 9)) for _ in range(length)]
    return "".join(digits)


def clean_phone_number(phone: str) -> str:
    """Clean and normalize phone number into international format digits."""
    cleaned = re.sub(r"[^\d+]", "", phone.strip())
    if cleaned.startswith("+"):
        cleaned = cleaned[1:]
    # If starting with '0' for Nigerian numbers (11 digits), format as 234...
    if cleaned.startswith("0") and len(cleaned) == 11:
        cleaned = "234" + cleaned[1:]
    return cleaned


class TermiiClient:
    """Async client for Termii SMS Gateway."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        sender_id: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        self.api_key = api_key or settings.termii_api_key
        self.sender_id = sender_id or settings.termii_sender_id or "Lenis"
        self.base_url = (base_url or settings.termii_base_url or "https://api.ng.termii.com").rstrip("/")

    async def send_sms(self, to_phone: str, message: str) -> dict[str, Any]:
        """Send an SMS via Termii REST API.

        When no API key is configured (development/sandbox), logs the SMS and
        returns a simulated success response.
        """
        normalized_phone = clean_phone_number(to_phone)

        if not self.api_key:
            logger.info(
                "[DEV/SANDBOX TERMII] SMS to %s via Sender '%s': %s",
                normalized_phone,
                self.sender_id,
                message,
            )
            return {
                "status": "success",
                "message": "SMS dispatched (Sandbox Mode)",
                "to": normalized_phone,
                "sandbox": True,
            }

        url = f"{self.base_url}/api/sms/send"
        payload = {
            "to": normalized_phone,
            "from": self.sender_id,
            "sms": message,
            "type": "plain",
            "channel": "generic",
            "api_key": self.api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, json=payload)
                data = response.json()
                logger.info("Termii SMS response for %s: %s", normalized_phone, data)
                return data
        except Exception as exc:
            logger.error("Failed to send Termii SMS to %s: %s", normalized_phone, exc)
            return {
                "status": "error",
                "message": str(exc),
                "to": normalized_phone,
            }

    async def send_phone_otp(self, to_phone: str, otp_code: str) -> dict[str, Any]:
        """Send a 6-digit phone verification OTP code."""
        message = (
            f"Your Lenis verification code is {otp_code}. "
            f"Valid for 10 minutes. Do not share this code with anyone."
        )
        return await self.send_sms(to_phone=to_phone, message=message)


_default_termii_client: Optional[TermiiClient] = None


def get_termii_client() -> TermiiClient:
    """Return singleton TermiiClient instance."""
    global _default_termii_client
    if _default_termii_client is None:
        _default_termii_client = TermiiClient()
    return _default_termii_client
