"""KYC (Know Your Customer) service.

Handles identity verification through two flows:
- **Dojah API** (when ``USE_DOJAH=True``): widget-based automated verification.
- **Manual document upload** (when ``USE_DOJAH=False``): admin-reviewed flow.

The ``can_transition_kyc`` helper encodes the valid KYC state machine and is
also used by property-based tests (Property 3).

Valid KYC transitions
---------------------
- ``not_started`` → ``pending``    (manual submission / Dojah result)
- ``pending``     → ``approved``   (admin action)
- ``pending``     → ``rejected``   (admin action)
- ``rejected``    → ``pending``    (merchant resubmission)

Any other transition raises HTTP 409 with code ``INVALID_KYC_TRANSITION``.

Requirements: 4.1, 4.2, 12.1, 12.2, 12.8
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.models import MerchantProfile

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Valid KYC transitions (encoded once, used by service and property tests)
# ---------------------------------------------------------------------------

_VALID_KYC_TRANSITIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("not_started", "pending"),
        ("pending", "approved"),
        ("pending", "rejected"),
        ("rejected", "pending"),
    }
)


# ---------------------------------------------------------------------------
# KYCResult — returned by handle_dojah_webhook
# ---------------------------------------------------------------------------


@dataclass
class KYCResult:
    """Result of a Dojah webhook callback.

    Attributes
    ----------
    status:
        The normalised KYC status string. One of ``'approved'``, ``'rejected'``,
        or ``'pending'``.
    reason:
        Human-readable reason for the result. ``None`` on approval.
    """

    status: str
    reason: str | None = None


# ---------------------------------------------------------------------------
# Pure validation helper (also consumed by property-based test 14.3)
# ---------------------------------------------------------------------------


def can_transition_kyc(current: str, target: str) -> bool:
    """Return ``True`` if transitioning from *current* to *target* is valid.

    This is a pure function — no database access, no side effects.

    Parameters
    ----------
    current:
        The current ``kyc_status`` value.
    target:
        The desired next ``kyc_status`` value.

    Examples
    --------
    >>> can_transition_kyc("not_started", "pending")
    True
    >>> can_transition_kyc("approved", "pending")
    False
    """
    return (current, target) in _VALID_KYC_TRANSITIONS


# ---------------------------------------------------------------------------
# KYCService
# ---------------------------------------------------------------------------


class KYCService:
    """Stateless service for KYC operations.

    All methods are ``@staticmethod`` so callers do not need to instantiate
    the class. The database session is accepted as an explicit argument on
    methods that require persistence, following the pattern used across the
    Lenis service layer.
    """

    # ------------------------------------------------------------------
    # Dojah flow (USE_DOJAH=True)
    # ------------------------------------------------------------------

    @staticmethod
    async def initiate_dojah_verification(
        merchant_id: uuid.UUID,
        app_id: str,
        secret_key: str,
    ) -> str:
        """Start a Dojah identity verification session.

        Makes an authenticated POST request to the Dojah easyLookup widget
        initialisation endpoint and returns the resulting session ID.

        Parameters
        ----------
        merchant_id:
            The merchant's user UUID — sent as the ``reference_id`` so that
            the Dojah webhook can be correlated back to the correct profile.
        app_id:
            Dojah ``AppId`` header value.
        secret_key:
            Dojah ``SecretKey`` header value.

        Returns
        -------
        str
            The Dojah ``session_id`` (or equivalent reference token).

        Raises
        ------
        HTTPException(503)
            If the Dojah API does not respond within 30 seconds.
        HTTPException(502)
            If the Dojah API returns an unexpected error response.
        """
        url = "https://api.dojah.io/api/v1/kyc/widget"
        headers = {
            "AppId": app_id,
            "SecretKey": secret_key,
            "Content-Type": "application/json",
        }
        body = {
            "reference_id": str(merchant_id),
            "type": "kyc",
        }

        logger.info(
            "Initiating Dojah verification session for merchant_id=%s", merchant_id
        )

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=body, headers=headers)
        except httpx.TimeoutException:
            logger.warning(
                "Dojah API timed out for merchant_id=%s", merchant_id
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "detail": "Dojah verification service did not respond in time. Please retry.",
                    "code": "DOJAH_TIMEOUT",
                },
            )
        except httpx.RequestError as exc:
            logger.error(
                "Dojah API request failed for merchant_id=%s: %s", merchant_id, exc
            )
            raise HTTPException(
                status_code=503,
                detail={
                    "detail": "Dojah verification service is temporarily unavailable.",
                    "code": "DOJAH_TIMEOUT",
                },
            )

        if response.status_code not in (200, 201):
            logger.error(
                "Dojah API returned %s for merchant_id=%s: %s",
                response.status_code,
                merchant_id,
                response.text,
            )
            raise HTTPException(
                status_code=502,
                detail={
                    "detail": "Dojah verification service returned an unexpected response.",
                    "code": "DOJAH_TIMEOUT",
                },
            )

        data = response.json()

        # Dojah returns ``entity.session_id`` in successful responses.
        session_id: str | None = (
            data.get("entity", {}).get("session_id")
            or data.get("session_id")
        )

        if not session_id:
            logger.error(
                "Dojah API response missing session_id for merchant_id=%s: %s",
                merchant_id,
                data,
            )
            raise HTTPException(
                status_code=502,
                detail={
                    "detail": "Dojah verification service returned an unexpected response.",
                    "code": "DOJAH_TIMEOUT",
                },
            )

        logger.info(
            "Dojah session initiated: session_id=%s merchant_id=%s",
            session_id,
            merchant_id,
        )
        return session_id

    # ------------------------------------------------------------------

    @staticmethod
    async def handle_dojah_webhook(payload: dict) -> KYCResult:
        """Parse an inbound Dojah webhook callback payload.

        Dojah posts a JSON body containing a ``status`` field with values
        such as ``'success'``/``'successful'`` (approved) or ``'failed'``/
        ``'rejected'`` (rejected). This method normalises those values into
        the platform's ``KYCResult`` domain type.

        Parameters
        ----------
        payload:
            The raw parsed JSON dict from the Dojah webhook POST body.

        Returns
        -------
        KYCResult
            Normalised result with ``status`` in ``{approved, rejected, pending}``
            and an optional ``reason``.
        """
        raw_status: str = (
            payload.get("status")
            or payload.get("entity", {}).get("status")
            or ""
        ).lower()

        reason: str | None = (
            payload.get("reason")
            or payload.get("entity", {}).get("reason")
        )

        logger.debug("Handling Dojah webhook: raw_status=%r reason=%r", raw_status, reason)

        if raw_status in ("success", "successful", "approved"):
            return KYCResult(status="approved", reason=None)

        if raw_status in ("failed", "rejected", "failure"):
            return KYCResult(
                status="rejected",
                reason=reason or "Identity verification failed.",
            )

        # Treat any other status as still pending (e.g. 'processing')
        logger.warning(
            "Dojah webhook received unrecognised status %r — treating as pending",
            raw_status,
        )
        return KYCResult(status="pending", reason=reason)

    # ------------------------------------------------------------------
    # Didit Automated KYC Flow
    # ------------------------------------------------------------------

    @staticmethod
    async def initiate_didit_session(
        merchant_id: uuid.UUID,
        callback_url: str | None = None,
    ) -> dict[str, str]:
        """Start a Didit automated identity verification session.

        Calls POST https://verification.didit.me/v3/session/
        with x-api-key header and workflow_id.

        Returns
        -------
        dict[str, str]
            {"session_id": session_id, "url": hosted_url}
        """
        api_key = settings.didit_api_key
        workflow_id = settings.didit_workflow_id
        base_url = settings.didit_base_url.rstrip("/")

        if not api_key:
            logger.info("Didit API key not configured, returning mock session for merchant %s", merchant_id)
            mock_session_id = f"didit_mock_{uuid.uuid4().hex[:16]}"
            return {
                "session_id": mock_session_id,
                "url": f"https://verification.didit.me/v3/mock-verify?session={mock_session_id}",
            }

        url = f"{base_url}/session/"
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
        }
        body: dict[str, str] = {
            "workflow_id": workflow_id,
            "vendor_data": str(merchant_id),
        }
        cb = callback_url or settings.didit_callback_url
        if cb:
            body["callback"] = cb

        logger.info("Initiating Didit verification session for merchant_id=%s", merchant_id)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=body, headers=headers)
        except httpx.TimeoutException:
            logger.warning("Didit API timed out for merchant_id=%s", merchant_id)
            raise HTTPException(
                status_code=503,
                detail={
                    "detail": "Didit verification service did not respond in time. Please retry.",
                    "code": "DIDIT_TIMEOUT",
                },
            )
        except httpx.RequestError as exc:
            logger.error("Didit API request failed for merchant_id=%s: %s", merchant_id, exc)
            raise HTTPException(
                status_code=503,
                detail={
                    "detail": f"Didit verification service is unavailable: {exc}",
                    "code": "DIDIT_ERROR",
                },
            )

        if response.status_code not in (200, 201):
            logger.error("Didit API returned %s: %s", response.status_code, response.text)
            raise HTTPException(
                status_code=502,
                detail={
                    "detail": f"Didit service returned unexpected status ({response.status_code}).",
                    "code": "DIDIT_ERROR",
                },
            )

        data = response.json()
        session_id = data.get("session_id") or data.get("id") or data.get("sessionId")
        hosted_url = data.get("url") or data.get("session_url") or data.get("hosted_url")

        if not session_id or not hosted_url:
            logger.error("Didit API response missing session_id or url: %s", data)
            raise HTTPException(
                status_code=502,
                detail={
                    "detail": "Didit verification response missing session details.",
                    "code": "DIDIT_ERROR",
                },
            )

        logger.info("Didit session created: session_id=%s for merchant_id=%s", session_id, merchant_id)
        return {
            "session_id": str(session_id),
            "url": str(hosted_url),
        }

    @staticmethod
    async def get_didit_session_decision(session_id: str) -> KYCResult:
        """Query Didit decision endpoint for the given session.

        Calls GET https://verification.didit.me/v3/session/{sessionId}/decision/
        """
        api_key = settings.didit_api_key
        base_url = settings.didit_base_url.rstrip("/")

        if not api_key:
            logger.info("Didit API key not configured, returning approved decision in sandbox mode for %s", session_id)
            return KYCResult(status="approved", reason=None)

        url = f"{base_url}/session/{session_id}/decision/"
        headers = {
            "x-api-key": api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(url, headers=headers)
        except Exception as exc:
            logger.error("Failed to query Didit decision for session %s: %s", session_id, exc)
            return KYCResult(status="pending", reason="Verification in progress.")

        if response.status_code == 404:
            return KYCResult(status="pending", reason="Session verification is still in progress.")

        if response.status_code not in (200, 201):
            logger.warning("Didit decision endpoint returned %s: %s", response.status_code, response.text)
            return KYCResult(status="pending", reason="Decision pending.")

        data = response.json()
        raw_status = str(data.get("status") or data.get("decision") or "").strip()
        reason = data.get("reason") or data.get("declined_reason") or data.get("message")

        if raw_status in ("Approved", "approved", "Success", "success"):
            return KYCResult(status="approved", reason=None)
        elif raw_status in ("Declined", "declined", "Rejected", "rejected", "Failed", "failed"):
            return KYCResult(status="rejected", reason=reason or "Automated identity verification was declined.")
        elif raw_status in ("In Review", "in_review", "Pending", "pending", "Submitted", "Processing", "processing"):
            return KYCResult(status="pending", reason="Verification under review.")

        return KYCResult(status="pending", reason=reason)

    @staticmethod
    def handle_didit_webhook(
        payload: dict,
        signature: str | None = None,
        raw_body: bytes | None = None,
    ) -> tuple[str | None, str | None, KYCResult]:
        """Verify signature and parse incoming Didit webhook.

        Returns (session_id, user_id, KYCResult)
        """
        secret = settings.didit_webhook_secret_key
        if secret and signature and raw_body:
            expected_sig = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected_sig):
                logger.warning("Invalid Didit webhook HMAC signature")
                raise HTTPException(status_code=401, detail="Invalid webhook signature")

        session_id = (
            payload.get("session_id")
            or payload.get("sessionId")
            or payload.get("data", {}).get("session_id")
            or payload.get("entity", {}).get("session_id")
        )
        vendor_data = (
            payload.get("vendor_data")
            or payload.get("vendorData")
            or payload.get("data", {}).get("vendor_data")
        )
        event_type = (
            payload.get("event_type")
            or payload.get("event")
            or payload.get("type")
            or ""
        ).lower()
        status_val = (
            payload.get("status")
            or payload.get("decision")
            or payload.get("data", {}).get("status")
            or ""
        )
        reason = payload.get("reason") or payload.get("declined_reason")

        if event_type == "session.verified" or str(status_val).lower() in ("approved", "success"):
            return (session_id, vendor_data, KYCResult(status="approved", reason=None))
        elif event_type == "session.declined" or str(status_val).lower() in ("declined", "rejected", "failed"):
            return (session_id, vendor_data, KYCResult(status="rejected", reason=reason or "Identity verification declined."))

        return (session_id, vendor_data, KYCResult(status="pending", reason=reason))

    # ------------------------------------------------------------------
    # Manual document upload flow (USE_DOJAH=False)
    # ------------------------------------------------------------------

    @staticmethod
    async def submit_manual_kyc(
        merchant_id: uuid.UUID,
        nin: str | None,
        doc_type: str | None,
        doc_path: str,
        db: AsyncSession,
    ) -> None:
        """Store KYC document reference and transition status to ``pending``.

        Validates the current KYC status allows the transition to ``pending``
        (i.e. ``not_started`` or ``rejected``), then persists the document
        reference and clears any previous rejection reason.

        Parameters
        ----------
        merchant_id:
            The merchant's user UUID (FK in ``merchant_profiles``).
        nin:
            Nigeria-only National Identification Number (11 digits).
            ``None`` for non-Nigerian merchants.
        doc_type:
            Document type string, e.g. ``'passport'``, ``'national_id'``,
            ``'drivers_license'``, ``'nin_slip'``. ``None`` when ``nin`` is
            provided as the primary identifier.
        doc_path:
            Storage path returned by the ``StorageBackend`` after upload.
        db:
            Active async SQLAlchemy session.

        Raises
        ------
        HTTPException(404)
            Merchant profile does not exist.
        HTTPException(409)
            Current KYC status does not allow a transition to ``pending``
            (code: ``INVALID_KYC_TRANSITION``).
        """
        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == merchant_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "Merchant profile not found.",
                    "code": "PROFILE_NOT_FOUND",
                },
            )

        if not can_transition_kyc(profile.kyc_status, "pending"):
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": (
                        f"Cannot transition KYC status from "
                        f"'{profile.kyc_status}' to 'pending'."
                    ),
                    "code": "INVALID_KYC_TRANSITION",
                },
            )

        # Apply updates
        profile.kyc_document_path = doc_path
        profile.kyc_document_type = doc_type
        profile.nin = nin
        profile.kyc_status = "pending"
        # Clear any previous rejection reason on resubmission (Requirement 12.8)
        profile.kyc_rejection_reason = None

        await db.commit()

        logger.info(
            "Manual KYC submitted: merchant_id=%s doc_type=%r",
            merchant_id,
            doc_type,
        )
