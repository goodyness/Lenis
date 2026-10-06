"""
Developer API router — all `/v1/` endpoints.

Registers the following routes:

    POST   /v1/payments                — create payment intent
    GET    /v1/payments                — list payments
    GET    /v1/payments/{payment_id}   — retrieve single payment
    GET    /v1/transactions            — list confirmed/paid transactions
    GET    /v1/transactions/{tx_id}    — retrieve single transaction
    POST   /v1/payment-links           — create payment link
    GET    /v1/payment-links           — list payment links
    GET    /v1/payment-links/{link_id} — retrieve payment link

Authentication: all routes use the ``get_api_key_org`` dependency which
validates the ``sk_test_*`` / ``sk_live_*`` Bearer token and populates
``request.state.test_mode``.

Requirements: 5.1, 6.1, 7.1, 8.1, 19.4, 19.5
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.models import Organization, User
from app.developer import service
from app.developer.auth import get_api_key_org
from app.developer.schemas import (
    ListResponse,
    PaymentIntentRequest,
    PaymentIntentResponse,
    PaymentLinkCreateRequest,
    PaymentLinkResponse,
)

router = APIRouter(prefix="/v1", tags=["Developer API"])


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


@router.post(
    "/payments",
    response_model=PaymentIntentResponse,
    status_code=201,
    summary="Create a payment intent",
)
async def create_payment(
    request: Request,
    data: PaymentIntentRequest,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    """Create a new payment intent and return a checkout URL.

    Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 5.10, 5.11
    """
    org: Organization
    user: User
    org, user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.create_payment_intent(
        org=org,
        user=user,
        test_mode=test_mode,
        data=data,
        db=db,
    )


@router.get(
    "/payments",
    response_model=ListResponse,
    summary="List payments",
)
async def list_payments(
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    network: Optional[str] = Query(default=None),
    token_symbol: Optional[str] = Query(default=None),
    created_after: Optional[str] = Query(default=None),
    created_before: Optional[str] = Query(default=None),
) -> ListResponse:
    """List payments for the authenticated organisation.

    Supports optional filtering by status, network, token_symbol,
    created_after, and created_before (ISO 8601 datetime strings).

    Requirements: 6.2, 6.3, 6.4, 6.5, 16.3, 16.4, 16.6
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    filters: dict = {}
    if status is not None:
        filters["status"] = status
    if network is not None:
        filters["network"] = network
    if token_symbol is not None:
        filters["token_symbol"] = token_symbol
    if created_after is not None:
        filters["created_after"] = created_after
    if created_before is not None:
        filters["created_before"] = created_before

    return await service.list_payments(
        org=org,
        test_mode=test_mode,
        filters=filters,
        limit=limit,
        cursor=cursor,
        db=db,
    )


@router.get(
    "/payments/{payment_id}",
    response_model=PaymentIntentResponse,
    summary="Retrieve a payment",
)
async def get_payment(
    payment_id: str,
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    """Retrieve a single payment by ID.

    Returns HTTP 404 if the payment does not exist, belongs to a different
    organisation, or was created in the opposite test/live mode.

    Requirements: 6.1, 16.3, 16.4
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.get_payment(
        org=org,
        payment_id=payment_id,
        test_mode=test_mode,
        db=db,
    )


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------


@router.get(
    "/transactions",
    response_model=ListResponse,
    summary="List transactions",
)
async def list_transactions(
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    network: Optional[str] = Query(default=None),
    token_symbol: Optional[str] = Query(default=None),
    min_amount: Optional[str] = Query(default=None),
    max_amount: Optional[str] = Query(default=None),
    confirmed_after: Optional[str] = Query(default=None),
    confirmed_before: Optional[str] = Query(default=None),
) -> ListResponse:
    """List confirmed and paid payments as transactions.

    Requirements: 8.1, 8.2, 8.3, 8.4
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    filters: dict = {}
    if network is not None:
        filters["network"] = network
    if token_symbol is not None:
        filters["token_symbol"] = token_symbol
    if min_amount is not None:
        filters["min_amount"] = min_amount
    if max_amount is not None:
        filters["max_amount"] = max_amount
    if confirmed_after is not None:
        filters["confirmed_after"] = confirmed_after
    if confirmed_before is not None:
        filters["confirmed_before"] = confirmed_before

    return await service.list_transactions(
        org=org,
        test_mode=test_mode,
        filters=filters,
        limit=limit,
        cursor=cursor,
        db=db,
    )


@router.get(
    "/transactions/{transaction_id}",
    response_model=PaymentIntentResponse,
    summary="Retrieve a transaction",
)
async def get_transaction(
    transaction_id: str,
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> PaymentIntentResponse:
    """Retrieve a single confirmed/paid payment as a transaction.

    Returns HTTP 404 if not found, not confirmed/paid, or wrong org/mode.

    Requirements: 8.1, 8.2
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.get_transaction(
        org=org,
        transaction_id=transaction_id,
        test_mode=test_mode,
        db=db,
    )


# ---------------------------------------------------------------------------
# Payment Links
# ---------------------------------------------------------------------------


@router.post(
    "/payment-links",
    response_model=PaymentLinkResponse,
    status_code=201,
    summary="Create a payment link",
)
async def create_payment_link(
    request: Request,
    data: PaymentLinkCreateRequest,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkResponse:
    """Create a developer-managed payment link.

    Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
    """
    org: Organization
    user: User
    org, user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.create_developer_payment_link(
        org=org,
        user=user,
        test_mode=test_mode,
        data=data,
        db=db,
    )


@router.get(
    "/payment-links",
    response_model=ListResponse,
    summary="List payment links",
)
async def list_payment_links(
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
) -> ListResponse:
    """List payment links for the authenticated organisation.

    Requirements: 7.3, 7.4
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.list_developer_payment_links(
        org=org,
        test_mode=test_mode,
        limit=limit,
        cursor=cursor,
        db=db,
    )


@router.get(
    "/payment-links/{link_id}",
    response_model=PaymentLinkResponse,
    summary="Retrieve a payment link",
)
async def get_payment_link(
    link_id: str,
    request: Request,
    auth_result: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkResponse:
    """Retrieve a single payment link by ID.

    Requirements: 7.2
    """
    org: Organization
    org, _user, _key_id = auth_result
    test_mode: bool = request.state.test_mode

    return await service.get_developer_payment_link(
        org=org,
        link_id=link_id,
        test_mode=test_mode,
        db=db,
    )
