"""
Blockchain webhook endpoint for Lenis platform.

Receives signed event payloads from Alchemy and QuickNode webhook push
services and dispatches processing to a Celery task.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/webhooks/blockchain", status_code=200, tags=["blockchain"])
async def receive_blockchain_webhook(request: Request) -> dict:
    """Accept signed blockchain event payloads from Alchemy or QuickNode.

    - Reads raw body bytes BEFORE JSON-parsing (required for correct HMAC).
    - Validates the provider-specific HMAC signature — returns 401 on failure.
    - Dispatches processing to the process_blockchain_event Celery task.
    - Returns 200 within 500ms by offloading all heavy work to the task.
    """
    # Read raw bytes first — must happen before any JSON parsing so the
    # HMAC is computed over the exact bytes the provider signed.
    body_bytes = await request.body()

    # Import here to avoid circular imports at module load time.
    from app.web3.indexer import _validate_provider_signature, process_blockchain_event

    # Raises HTTPException(401) if signature validation fails.
    _validate_provider_signature(body_bytes, request.headers)

    payload = json.loads(body_bytes)

    # Dispatch to Celery — this returns immediately, keeping the handler
    # well under the 500ms SLA required so the provider does not retry.
    process_blockchain_event.delay(payload)

    return {"status": "accepted"}
