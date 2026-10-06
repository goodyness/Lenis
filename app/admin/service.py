"""
Admin service for the Lenis platform.

``AdminService`` contains the business logic for admin-facing operations:
user listing with pagination, dashboard summary counts, and privileged
account management (suspend, reactivate, promote).

Requirements addressed by this module: 7.1, 7.2, 7.3, 7.4, 7.5, 7.8, 7.9,
14.1–14.10
"""
from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, asc, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admin.schemas import (
    AdminGlobalPayerItem,
    AdminPayerDetailResponse,
    AuditLogItem,
    DashboardSummaryResponse,
    KYCDocumentsResponse,
    MerchantDetailResponse,
    MerchantListItem,
    OkResponse,
    PaginatedAdminPayersResponse,
    PaginatedAuditLogResponse,
    PaginatedMerchantsResponse,
    PaginatedUsersResponse,
    PaginatedVerificationRequestsResponse,
    SuspensionAppealItem,
    PaginatedAppealsResponse,
    UserListItem,
    VerificationRequestDetail,
    VerificationRequestListItem,
    WalletInfo,
)
from app.merchant.schemas import (
    PayerActivityLogItem,
    PayerDirectoryResponse,
    TransactionListResponse,
)
from app.core.models import (
    APIKey,
    AuditLog,
    Invoice,
    MerchantProfile,
    MerchantWallet,
    Organization,
    Payment,
    PaymentLink,
    RefreshToken,
    SuspensionAppeal,
    User,
    VerificationRequest,
)
from app.users.schemas import APIKeyHistoryItem, APIKeyHistoryResponse
from app.core.storage import get_storage_backend
from app.core.tasks import send_kyc_decision_email

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_PAGE_SIZE = 20
_MAX_PAGE_SIZE = 100


def _normalize_dt(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure datetime is timezone-aware UTC datetime for safe comparisons across SQLite and Postgres."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


_USD_STABLECOINS = {"USDC", "USDT", "DAI", "BUSD", "PYUSD", "USDC.E", "USDT.E"}


def _resolve_usd_amount(payment: Payment, link: Optional[PaymentLink], invoice: Optional[Invoice]) -> Optional[Decimal]:
    """Resolve the equivalent USD/USDT value for a payment transaction."""
    if link and link.amount is not None and Decimal(str(link.amount)) > 0:
        return Decimal(str(link.amount))
    if invoice and invoice.total_amount is not None and Decimal(str(invoice.total_amount)) > 0:
        return Decimal(str(invoice.total_amount))
    if payment.token_symbol and payment.token_symbol.upper() in _USD_STABLECOINS and payment.amount is not None:
        return Decimal(str(payment.amount))
    return None


class AdminService:
    """Stateless service holding all admin-panel business logic.

    Every public method accepts an ``AsyncSession`` as its first argument so
    that all database operations participate in the same unit of work managed
    by the FastAPI dependency (``get_db()``).
    """

    # ------------------------------------------------------------------
    # List Users (Requirement 7.2)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_users(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        status: str | None = None,
        account_type: str | None = None,
    ) -> PaginatedUsersResponse:
        """Return a paginated list of platform users with optional filters.

        Supports filtering by ``status`` (e.g. "active", "suspended") and
        ``account_type`` (e.g. "developer", "merchant").  Page numbering is
        1-based.  ``page_size`` is clamped to a maximum of 100 records.

        Parameters
        ----------
        db:
            Active async database session.
        page:
            1-based page number. Defaults to 1.
        page_size:
            Number of records per page. Defaults to 20, capped at 100.
        status:
            Optional filter on the ``status`` column.
        account_type:
            Optional filter on the ``account_type`` column.

        Returns
        -------
        PaginatedUsersResponse
            Paginated wrapper containing the matching user records plus
            total count, current page, page_size, and total page count.

        Requirement 7.2
        """
        # Clamp page_size to allowed bounds
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        # Build the base query
        base_query = select(User)
        count_query = select(func.count()).select_from(User)

        if status is not None:
            base_query = base_query.where(User.status == status)
            count_query = count_query.where(User.status == status)

        if account_type is not None:
            base_query = base_query.where(User.account_type == account_type)
            count_query = count_query.where(User.account_type == account_type)

        # Execute count query for pagination metadata
        total_result = await db.execute(count_query)
        total: int = total_result.scalar_one()

        # Execute the paginated data query ordered by creation date descending
        data_result = await db.execute(
            base_query.order_by(User.created_at.desc()).offset(offset).limit(page_size)
        )
        users = data_result.scalars().all()

        items = [
            UserListItem(
                id=u.id,
                email=u.email,
                role=u.account_type,
                account_type=u.account_type,
                status=u.status,
                created_at=u.created_at,
            )
            for u in users
        ]

        pages = math.ceil(total / page_size) if total > 0 else 1

        return PaginatedUsersResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=pages,
        )

    # ------------------------------------------------------------------
    # Dashboard Summary (Requirement 7.1)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_dashboard_summary(db: AsyncSession) -> DashboardSummaryResponse:
        """Return aggregate counts for the admin dashboard overview.

        Executes four lightweight COUNT queries to populate the summary card
        metrics shown at the top of the admin dashboard.

        Counts returned
        ---------------
        total_users:
            All rows in the ``users`` table regardless of account type or status.
        pending_verification_requests:
            ``VerificationRequest`` rows where ``status = 'pending'``.
        verified_developers:
            ``User`` rows where ``account_type = 'developer'`` and
            ``status = 'verified'``.
        active_merchants:
            ``User`` rows where ``account_type = 'merchant'`` and
            ``status = 'active'``.

        Requirement 7.1
        """
        # Total users
        total_result = await db.execute(
            select(func.count()).select_from(User)
        )
        total_users: int = total_result.scalar_one()

        # Pending verification requests
        pending_result = await db.execute(
            select(func.count())
            .select_from(VerificationRequest)
            .where(VerificationRequest.status == "pending")
        )
        pending_verification_requests: int = pending_result.scalar_one()

        # Verified developers
        verified_dev_result = await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.account_type == "developer", User.status == "verified")
        )
        verified_developers: int = verified_dev_result.scalar_one()

        # Active merchants
        active_merchant_result = await db.execute(
            select(func.count())
            .select_from(User)
            .where(User.account_type == "merchant", User.status == "active")
        )
        active_merchants: int = active_merchant_result.scalar_one()

        return DashboardSummaryResponse(
            total_users=total_users,
            pending_verification_requests=pending_verification_requests,
            verified_developers=verified_developers,
            active_merchants=active_merchants,
        )

    # ------------------------------------------------------------------
    # Suspend User (Requirements 7.3, 7.5, 7.8)
    # ------------------------------------------------------------------

    @staticmethod
    async def suspend_user(
        db: AsyncSession,
        *,
        actor_id: uuid.UUID,
        target_id: uuid.UUID,
        reason: str | None = None,
        message: str | None = None,
    ) -> OkResponse:
        """Suspend a platform user.

        Raises HTTP 403 if the target user is a superadmin and the acting
        user is not a superadmin. Raises HTTP 404 if the target is not found.
        Sets ``user.status = "suspended"``, stores the optional ``reason`` and
        ``message`` on the user, and revokes all active ``RefreshToken`` records.
        Writes a ``user.suspend`` audit log entry.

        Parameters
        ----------
        db:
            Active async database session.
        actor_id:
            ID of the admin performing the action.
        target_id:
            ID of the user to suspend.
        reason:
            Short machine-readable reason category shown to the suspended user.
        message:
            Free-form message from the admin explaining the suspension.

        Requirements 7.3, 7.5, 7.8
        """
        # Load actor and target
        actor_result = await db.execute(select(User).where(User.id == actor_id))
        actor: User | None = actor_result.scalar_one_or_none()

        target_result = await db.execute(select(User).where(User.id == target_id))
        target: User | None = target_result.scalar_one_or_none()

        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        # Guard: non-superadmin cannot act on superadmin accounts
        if (
            target.account_type == "superadmin"
            and (actor is None or actor.account_type != "superadmin")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "detail": "You cannot suspend a superadmin account.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        # Set status to suspended and record reason/message
        target.status = "suspended"
        target.suspension_reason = reason
        target.suspension_message = message

        # Revoke all active refresh tokens for the target
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == target_id, RefreshToken.revoked.is_(False))
            .values(revoked=True)
        )

        # Write audit log entry
        audit = AuditLog(
            event_type="user.suspend",
            actor_id=actor_id,
            target_type="user",
            target_id=target_id,
            outcome="success",
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                target_id,
                title="Account Suspended",
                message=message or reason or "Your account has been suspended by compliance.",
                type="account_status",
                link="/appeal",
                commit=False,
            )
            from app.core.tasks import send_account_status_changed_email
            send_account_status_changed_email.delay(
                user_id=str(target_id),
                status="suspended",
                reason=message or reason,
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch account suspension notification: %s", notif_err)

        await db.commit()

        return OkResponse(message="User suspended successfully.", code="USER_SUSPENDED")

    # ------------------------------------------------------------------
    # Reactivate User (Requirements 7.4, 7.5, 7.9)
    # ------------------------------------------------------------------

    @staticmethod
    async def reactivate_user(
        db: AsyncSession,
        *,
        actor_id: uuid.UUID,
        target_id: uuid.UUID,
    ) -> OkResponse:
        """Reactivate a suspended platform user.

        Raises HTTP 403 if the target user is a superadmin and the acting
        user is not a superadmin. Raises HTTP 404 if the target is not found.
        Sets ``user.status = "active"`` and writes a ``user.reactivate``
        audit log entry.

        Parameters
        ----------
        db:
            Active async database session.
        actor_id:
            ID of the admin performing the action.
        target_id:
            ID of the user to reactivate.

        Requirements 7.4, 7.5, 7.9
        """
        actor_result = await db.execute(select(User).where(User.id == actor_id))
        actor: User | None = actor_result.scalar_one_or_none()

        target_result = await db.execute(select(User).where(User.id == target_id))
        target: User | None = target_result.scalar_one_or_none()

        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        # Guard: non-superadmin cannot act on superadmin accounts
        if (
            target.account_type == "superadmin"
            and (actor is None or actor.account_type != "superadmin")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "detail": "You cannot reactivate a superadmin account.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        target.status = "active"

        audit = AuditLog(
            event_type="user.reactivate",
            actor_id=actor_id,
            target_type="user",
            target_id=target_id,
            outcome="success",
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                target_id,
                title="Account Reactivated",
                message="Your account has been reactivated and is now fully accessible.",
                type="account_status",
                link="/dashboard",
                commit=False,
            )
            from app.core.tasks import send_account_status_changed_email
            send_account_status_changed_email.delay(
                user_id=str(target_id),
                status="active",
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch account reactivation notification: %s", notif_err)

        await db.commit()

        return OkResponse(
            message="User reactivated successfully.", code="USER_REACTIVATED"
        )

    # ------------------------------------------------------------------
    # Promote to Admin (Requirements 7.5, 7.9)
    # ------------------------------------------------------------------

    @staticmethod
    async def promote_to_admin(
        db: AsyncSession,
        *,
        actor_id: uuid.UUID,
        target_id: uuid.UUID,
    ) -> OkResponse:
        """Promote a user to the admin role.

        Only a superadmin may call this method; HTTP 403 is raised otherwise.
        Raises HTTP 404 if the target user is not found. Sets
        ``user.account_type = "admin"`` and writes a ``user.promote_admin``
        audit log entry.

        Parameters
        ----------
        db:
            Active async database session.
        actor_id:
            ID of the superadmin performing the action.
        target_id:
            ID of the user to promote.

        Requirements 7.5, 7.9
        """
        actor_result = await db.execute(select(User).where(User.id == actor_id))
        actor: User | None = actor_result.scalar_one_or_none()

        # Actor must be superadmin (belt-and-suspenders check in addition to the
        # require_superadmin route dependency)
        if actor is None or actor.account_type != "superadmin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "detail": "Only superadmins can promote users to admin.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        target_result = await db.execute(select(User).where(User.id == target_id))
        target: User | None = target_result.scalar_one_or_none()

        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        target.account_type = "admin"

        audit = AuditLog(
            event_type="user.promote_admin",
            actor_id=actor_id,
            target_type="user",
            target_id=target_id,
            outcome="success",
        )
        db.add(audit)
        await db.commit()

        return OkResponse(
            message="User promoted to admin successfully.", code="USER_PROMOTED"
        )

    # ------------------------------------------------------------------
    # List Verification Requests (Requirement 7.6)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_verification_requests(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        status_filter: str | None = None,
    ) -> PaginatedVerificationRequestsResponse:
        """Return a paginated list of developer verification requests.

        Supports optional filtering by ``status_filter`` (pending, approved, rejected).
        Page numbering is 1-based. ``page_size`` is clamped to a maximum of 100.

        Parameters
        ----------
        db:
            Active async database session.
        page:
            1-based page number. Defaults to 1.
        page_size:
            Number of records per page. Defaults to 20, capped at 100.
        status_filter:
            Optional filter on the ``status`` column.

        Returns
        -------
        PaginatedVerificationRequestsResponse
            Paginated wrapper with items, total, page, page_size, and pages.

        Requirement 7.6
        """
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        base_query = select(VerificationRequest)
        count_query = select(func.count()).select_from(VerificationRequest)

        if status_filter is not None:
            base_query = base_query.where(VerificationRequest.status == status_filter)
            count_query = count_query.where(VerificationRequest.status == status_filter)

        total_result = await db.execute(count_query)
        total: int = total_result.scalar_one()

        data_result = await db.execute(
            base_query.order_by(VerificationRequest.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        requests = data_result.scalars().all()

        items = [
            VerificationRequestListItem(
                id=vr.id,
                developer_id=vr.developer_id,
                status=vr.status,
                full_legal_name=vr.full_legal_name,
                country=vr.country,
                business_type=vr.business_type,
                created_at=vr.created_at,
            )
            for vr in requests
        ]

        pages = math.ceil(total / page_size) if total > 0 else 1

        return PaginatedVerificationRequestsResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=pages,
        )

    # ------------------------------------------------------------------
    # Get Verification Request Detail (Requirement 7.7)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_verification_request(
        db: AsyncSession,
        request_id: uuid.UUID,
    ) -> VerificationRequestDetail:
        """Return full detail for a single verification request.

        Raises HTTP 404 if the request is not found. Returns all submitted
        developer information along with review metadata.

        Parameters
        ----------
        db:
            Active async database session.
        request_id:
            UUID of the ``VerificationRequest`` to retrieve.

        Returns
        -------
        VerificationRequestDetail
            Full detail including submitted fields and review metadata.

        Raises
        ------
        HTTPException(404)
            Verification request not found.

        Requirement 7.7
        """
        result = await db.execute(
            select(VerificationRequest).where(VerificationRequest.id == request_id)
        )
        vr = result.scalar_one_or_none()

        if vr is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "detail": "Verification request not found.",
                    "code": "VERIFICATION_REQUEST_NOT_FOUND",
                },
            )

        return VerificationRequestDetail(
            id=vr.id,
            developer_id=vr.developer_id,
            status=vr.status,
            full_legal_name=vr.full_legal_name,
            country=vr.country,
            business_type=vr.business_type,
            website_url=vr.website_url,
            intended_use=vr.intended_use,
            rejection_reason=vr.rejection_reason,
            reviewed_by=vr.reviewed_by,
            rejected_at=vr.rejected_at,
            created_at=vr.created_at,
            updated_at=vr.updated_at,
        )

    # ------------------------------------------------------------------
    # List Audit Log (Requirement 8.4)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_audit_log(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = 50,
        actor_id: Optional[uuid.UUID] = None,
        event_type: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> PaginatedAuditLogResponse:
        """Return a paginated, filterable list of audit log entries.

        Results are ordered by ``created_at`` descending so the most recent
        events appear first. Supports filtering by ``actor_id``, ``event_type``,
        and a UTC date range (``date_from`` / ``date_to``). Page numbering is
        1-based. ``page_size`` is clamped to a maximum of 200 records.

        Parameters
        ----------
        db:
            Active async database session.
        page:
            1-based page number. Defaults to 1.
        page_size:
            Number of records per page. Defaults to 50, capped at 200.
        actor_id:
            Optional filter restricting results to a specific actor UUID.
        event_type:
            Optional filter on the ``event_type`` column (exact match).
        date_from:
            Optional lower bound on ``created_at`` (inclusive).
        date_to:
            Optional upper bound on ``created_at`` (inclusive).

        Returns
        -------
        PaginatedAuditLogResponse
            Paginated wrapper containing the matching audit log records plus
            total count, current page, page_size, and total page count.

        Requirement 8.4
        """
        _DEFAULT_AUDIT_PAGE_SIZE = 50
        _MAX_AUDIT_PAGE_SIZE = 200

        page_size = max(1, min(page_size, _MAX_AUDIT_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        base_query = select(AuditLog)
        count_query = select(func.count()).select_from(AuditLog)

        if actor_id is not None:
            base_query = base_query.where(AuditLog.actor_id == actor_id)
            count_query = count_query.where(AuditLog.actor_id == actor_id)

        if event_type is not None:
            base_query = base_query.where(AuditLog.event_type == event_type)
            count_query = count_query.where(AuditLog.event_type == event_type)

        if date_from is not None:
            base_query = base_query.where(AuditLog.created_at >= date_from)
            count_query = count_query.where(AuditLog.created_at >= date_from)

        if date_to is not None:
            base_query = base_query.where(AuditLog.created_at <= date_to)
            count_query = count_query.where(AuditLog.created_at <= date_to)

        total_result = await db.execute(count_query)
        total: int = total_result.scalar_one()

        data_result = await db.execute(
            base_query.order_by(AuditLog.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        entries = data_result.scalars().all()

        items = [
            AuditLogItem(
                id=entry.id,
                event_type=entry.event_type,
                actor_id=entry.actor_id,
                target_type=entry.target_type,
                target_id=entry.target_id,
                outcome=entry.outcome,
                client_ip=entry.client_ip,
                created_at=entry.created_at,
            )
            for entry in entries
        ]

        pages = math.ceil(total / page_size) if total > 0 else 1

        return PaginatedAuditLogResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=pages,
        )

    # ------------------------------------------------------------------
    # List Merchants (Requirements 14.1)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_merchants(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
    ) -> PaginatedMerchantsResponse:
        """Return a paginated list of merchants with onboarding and KYC status.

        ``onboarding_status`` is a computed string:
        - ``incomplete``         — onboarding_complete=False AND kyc_status NOT in {'pending'}
        - ``pending_kyc_review`` — kyc_status='pending'
        - ``kyc_approved``       — kyc_status='approved'
        - ``kyc_rejected``       — kyc_status='rejected'

        ``wallet_count`` counts MerchantWallet rows where status != 'inactive'.

        Requirements: 14.1, 14.2
        """
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        # Count query
        count_result = await db.execute(
            select(func.count())
            .select_from(MerchantProfile)
            .join(User, User.id == MerchantProfile.user_id)
        )
        total: int = count_result.scalar_one()

        # Data query — join User + MerchantProfile, load wallets eagerly
        data_result = await db.execute(
            select(MerchantProfile)
            .join(User, User.id == MerchantProfile.user_id)
            .options(selectinload(MerchantProfile.user))
            .order_by(MerchantProfile.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        profiles = data_result.scalars().all()

        items: list[MerchantListItem] = []
        for profile in profiles:
            # Compute onboarding_status
            kyc = profile.kyc_status
            if kyc == "pending":
                onboarding_status = "pending_kyc_review"
            elif kyc == "approved":
                onboarding_status = "kyc_approved"
            elif kyc == "rejected":
                onboarding_status = "kyc_rejected"
            else:
                # 'not_started' or any unexpected value → incomplete
                onboarding_status = "incomplete"

            # Count active/pending wallets for this merchant
            wallet_count_result = await db.execute(
                select(func.count())
                .select_from(MerchantWallet)
                .where(
                    MerchantWallet.merchant_id == profile.user_id,
                    MerchantWallet.status != "inactive",
                )
            )
            wallet_count: int = wallet_count_result.scalar_one()

            items.append(
                MerchantListItem(
                    user_id=profile.user_id,
                    email=profile.user.email,
                    full_name=profile.full_name,
                    onboarding_status=onboarding_status,
                    kyc_status=profile.kyc_status,
                    wallet_count=wallet_count,
                )
            )

        pages = math.ceil(total / page_size) if total > 0 else 1

        return PaginatedMerchantsResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=pages,
        )

    # ------------------------------------------------------------------
    # Get Merchant Detail (Requirements 14.2, 14.3, 14.4)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_merchant_detail(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> MerchantDetailResponse:
        """Return full merchant profile detail.

        Fetches MerchantProfile + User + wallets in one query. Counts
        payment_links and invoices. Computes total confirmed payment volume.

        Requirements: 14.2, 14.3, 14.4
        """
        result = await db.execute(
            select(MerchantProfile)
            .where(MerchantProfile.user_id == user_id)
            .options(
                selectinload(MerchantProfile.user),
            )
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        # Fetch wallets
        wallets_result = await db.execute(
            select(MerchantWallet).where(MerchantWallet.merchant_id == user_id)
        )
        wallets = wallets_result.scalars().all()

        # Count payment links
        pl_count_result = await db.execute(
            select(func.count())
            .select_from(PaymentLink)
            .where(PaymentLink.merchant_id == user_id)
        )
        payment_link_count: int = pl_count_result.scalar_one()

        # Count invoices
        inv_count_result = await db.execute(
            select(func.count())
            .select_from(Invoice)
            .where(Invoice.merchant_id == user_id)
        )
        invoice_count: int = inv_count_result.scalar_one()

        # Total confirmed volume — sum of Payment.amount WHERE status='confirmed'
        # and payment_link_id belongs to this merchant
        merchant_link_ids_result = await db.execute(
            select(PaymentLink.id).where(PaymentLink.merchant_id == user_id)
        )
        merchant_link_ids = [row[0] for row in merchant_link_ids_result.fetchall()]

        total_confirmed_volume = Decimal("0")
        if merchant_link_ids:
            vol_result = await db.execute(
                select(func.sum(Payment.amount)).where(
                    and_(
                        Payment.payment_link_id.in_(merchant_link_ids),
                        Payment.status == "confirmed",
                    )
                )
            )
            vol = vol_result.scalar_one_or_none()
            if vol is not None:
                total_confirmed_volume = Decimal(str(vol))

        wallet_infos = [
            WalletInfo(
                id=w.id,
                network=w.network,
                address=w.address,
                status=w.status,
                created_at=w.created_at,
            )
            for w in wallets
        ]

        return MerchantDetailResponse(
            user_id=profile.user_id,
            email=profile.user.email,
            user_status=profile.user.status,
            full_name=profile.full_name,
            country=profile.country,
            phone_number=profile.phone_number,
            personal_info_status=profile.personal_info_status,
            personal_info_rejection_reason=profile.personal_info_rejection_reason,
            business_name=profile.business_name,
            business_address=profile.business_address,
            business_description=profile.business_description,
            business_category=profile.business_category,
            monthly_volume_estimate=profile.monthly_volume_estimate,
            website_url=profile.website_url,
            social_instagram=profile.social_instagram,
            social_twitter=profile.social_twitter,
            social_facebook=profile.social_facebook,
            social_linkedin=profile.social_linkedin,
            social_tiktok=profile.social_tiktok,
            is_registered_business=profile.is_registered_business,
            registration_doc_path=profile.registration_doc_path,
            business_info_status=profile.business_info_status,
            business_info_rejection_reason=profile.business_info_rejection_reason,
            kyc_status=profile.kyc_status,
            kyc_document_path=profile.kyc_document_path,
            kyc_document_type=profile.kyc_document_type,
            nin=profile.nin,
            kyc_dojah_session_id=profile.kyc_dojah_session_id,
            kyc_didit_session_id=profile.kyc_didit_session_id,
            kyc_reviewed_by=profile.kyc_reviewed_by,
            kyc_reviewed_at=profile.kyc_reviewed_at,
            kyc_rejection_reason=profile.kyc_rejection_reason,
            onboarding_complete=profile.onboarding_complete,
            onboarding_step=profile.onboarding_step,
            wallet_added=profile.wallet_added,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
            wallets=wallet_infos,
            payment_link_count=payment_link_count,
            invoice_count=invoice_count,
            total_confirmed_volume=total_confirmed_volume,
            kyc_doc_url=None,
            reg_doc_url=None,
        )

    @staticmethod
    async def get_merchant_api_keys(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> APIKeyHistoryResponse:
        """Fetch full API key credentials and rotation history for a merchant account."""
        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()
        if org is None:
            return APIKeyHistoryResponse(keys=[], total=0)

        history_result = await db.execute(
            select(APIKey)
            .where(APIKey.organization_id == org.id)
            .order_by(APIKey.created_at.desc())
        )
        keys = history_result.scalars().all()
        items = [
            APIKeyHistoryItem(
                id=k.id,
                key_type=k.key_type,
                prefix=k.prefix,
                suffix_display=k.suffix_display,
                active=k.active,
                created_at=k.created_at,
                revoked_at=k.revoked_at,
            )
            for k in keys
        ]
        return APIKeyHistoryResponse(keys=items, total=len(items))

    # ------------------------------------------------------------------
    # Get KYC Documents (Requirement 14.4)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_kyc_documents(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> KYCDocumentsResponse:
        """Return presigned download URLs for KYC and registration documents.

        URLs expire in 900 seconds (15 minutes, per Requirement 15.6).

        Requirements: 14.4, 15.6
        """
        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == user_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        is_s3 = (settings.upload_storage or "").strip().lower() == "s3"
        storage = get_storage_backend()

        kyc_document_url: str | None = None
        if profile.kyc_document_path:
            if is_s3:
                kyc_document_url = await storage.get_presigned_url(
                    profile.kyc_document_path, 900
                )
            else:
                kyc_document_url = f"/admin/merchants/{user_id}/documents/kyc"

        registration_doc_url: str | None = None
        if profile.registration_doc_path:
            if is_s3:
                registration_doc_url = await storage.get_presigned_url(
                    profile.registration_doc_path, 900
                )
            else:
                registration_doc_url = f"/admin/merchants/{user_id}/documents/registration"

        return KYCDocumentsResponse(
            kyc_document_url=kyc_document_url,
            registration_doc_url=registration_doc_url,
        )

    # ------------------------------------------------------------------
    # Approve KYC (Requirements 14.5, 12.6)
    # ------------------------------------------------------------------

    @staticmethod
    async def approve_kyc(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
    ) -> OkResponse:
        """Approve a merchant's KYC submission.

        Transitions ``kyc_status`` from ``pending`` to ``approved``, records
        the reviewing admin, writes an audit log entry, and dispatches the
        KYC decision email task.

        Requirements: 14.5, 12.6
        """
        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == merchant_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        if profile.kyc_status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "detail": "KYC is not in pending status.",
                    "code": "KYC_NOT_PENDING",
                },
            )

        profile.kyc_status = "approved"
        profile.kyc_reviewed_by = admin_id
        profile.kyc_reviewed_at = datetime.now(UTC)
        profile.personal_info_status = "approved"
        profile.personal_info_rejection_reason = None
        profile.business_info_status = "approved"
        profile.business_info_rejection_reason = None

        audit = AuditLog(
            event_type="kyc_approved",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                merchant_id,
                title="KYC Verification Approved",
                message="Your identity verification has been approved. You can now create payment links and invoices.",
                type="kyc_decision",
                link="/dashboard",
                commit=False,
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch kyc approval notification: %s", notif_err)

        await db.commit()

        send_kyc_decision_email.delay(str(merchant_id), "approved", None)

        return OkResponse(message="KYC approved successfully.", code="KYC_APPROVED")

    # ------------------------------------------------------------------
    # Reject KYC (Requirements 14.6, 12.7)
    # ------------------------------------------------------------------

    @staticmethod
    async def reject_kyc(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
        rejection_reason: str,
    ) -> OkResponse:
        """Reject a merchant's KYC submission with a mandatory reason.

        Transitions ``kyc_status`` from ``pending`` to ``rejected``, stores
        the rejection reason, records the reviewing admin, writes an audit
        log entry, and dispatches the KYC decision email task.

        Requirements: 14.6, 12.7
        """
        # Service-layer validation (belt-and-suspenders alongside Pydantic schema)
        if not rejection_reason or len(rejection_reason.strip()) < 1 or len(rejection_reason) > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": "rejection_reason must be between 1 and 500 characters.",
                    "code": "REJECTION_REASON_INVALID",
                },
            )

        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == merchant_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        if profile.kyc_status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "detail": "KYC is not in pending status.",
                    "code": "KYC_NOT_PENDING",
                },
            )

        profile.kyc_status = "rejected"
        profile.kyc_rejection_reason = rejection_reason
        profile.kyc_reviewed_by = admin_id
        profile.kyc_reviewed_at = datetime.now(UTC)

        audit = AuditLog(
            event_type="kyc_rejected",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                merchant_id,
                title="KYC Verification Not Approved",
                message=f"Action required: {rejection_reason}",
                type="kyc_decision",
                link="/onboarding",
                commit=False,
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch kyc rejection notification: %s", notif_err)

        await db.commit()

        send_kyc_decision_email.delay(str(merchant_id), "rejected", rejection_reason)

        return OkResponse(message="KYC rejected.", code="KYC_REJECTED")

    # ------------------------------------------------------------------
    # Revoke KYC Approval (Admin KYC Revocation / Correction Request)
    # ------------------------------------------------------------------

    @staticmethod
    async def revoke_kyc_approval(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
        rejection_reason: str,
        sections: list[str] | None = None,
    ) -> OkResponse:
        """Revoke a merchant's KYC approval and request updates on specific onboarding sections."""
        if not rejection_reason or len(rejection_reason.strip()) < 1 or len(rejection_reason) > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": "rejection_reason must be between 1 and 500 characters.",
                    "code": "REJECTION_REASON_INVALID",
                },
            )

        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == merchant_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()

        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        target_sections = set(sections) if sections else {"personal", "business", "kyc"}

        profile.kyc_status = "rejected"
        profile.kyc_rejection_reason = rejection_reason
        profile.kyc_reviewed_by = admin_id
        profile.kyc_reviewed_at = datetime.now(UTC)

        if "personal" in target_sections:
            profile.personal_info_status = "rejected"
            profile.personal_info_rejection_reason = rejection_reason

        if "business" in target_sections:
            profile.business_info_status = "rejected"
            profile.business_info_rejection_reason = rejection_reason

        audit = AuditLog(
            event_type="kyc_approval_revoked",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                merchant_id,
                title="KYC Update Requested",
                message=f"Admin requested updates on your verification details: {rejection_reason}",
                type="kyc_decision",
                link="/onboarding",
                commit=False,
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch kyc revocation notification: %s", notif_err)

        await db.commit()

        send_kyc_decision_email.delay(str(merchant_id), "rejected", rejection_reason)

        return OkResponse(
            message="KYC approval revoked and update requested from merchant.",
            code="KYC_APPROVAL_REVOKED",
        )

    # ------------------------------------------------------------------
    # Reject Merchant Section (Personal, Business, KYC)
    # ------------------------------------------------------------------

    @staticmethod
    async def reject_merchant_section(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
        section: str,
        rejection_reason: str,
    ) -> OkResponse:
        """Reject a specific section ('personal', 'business', or 'kyc') of a merchant profile."""
        if section not in ("personal", "business", "kyc"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": f"Invalid section '{section}'. Must be 'personal', 'business', or 'kyc'.",
                    "code": "INVALID_SECTION",
                },
            )
        if not rejection_reason or len(rejection_reason.strip()) < 1 or len(rejection_reason) > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": "rejection_reason must be between 1 and 500 characters.",
                    "code": "REJECTION_REASON_INVALID",
                },
            )

        result = await db.execute(
            select(MerchantProfile).where(MerchantProfile.user_id == merchant_id)
        )
        profile: MerchantProfile | None = result.scalar_one_or_none()
        if profile is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        if section == "personal":
            profile.personal_info_status = "rejected"
            profile.personal_info_rejection_reason = rejection_reason
        elif section == "business":
            profile.business_info_status = "rejected"
            profile.business_info_rejection_reason = rejection_reason
        elif section == "kyc":
            profile.kyc_status = "rejected"
            profile.kyc_rejection_reason = rejection_reason
            profile.kyc_reviewed_by = admin_id
            profile.kyc_reviewed_at = datetime.now(UTC)

        audit = AuditLog(
            event_type=f"merchant_section_rejected_{section}",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)
        await db.commit()

        if section == "kyc":
            send_kyc_decision_email.delay(str(merchant_id), "rejected", rejection_reason)

        return OkResponse(
            message=f"{section.capitalize()} section marked as rejected.",
            code="SECTION_REJECTED",
        )

    # ------------------------------------------------------------------
    # Suspend Merchant (Requirements 14.7, 14.8)
    # ------------------------------------------------------------------

    @staticmethod
    async def suspend_merchant(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
    ) -> OkResponse:
        """Suspend a merchant account and pause all their active payment links.

        - Sets ``User.status = 'suspended'``
        - Bulk-updates active PaymentLinks to ``suspended_by_admin``
        - Writes audit log entry
        - All three operations committed in one transaction

        Requirements: 14.7, 14.8
        """
        user_result = await db.execute(
            select(User).where(User.id == merchant_id)
        )
        user: User | None = user_result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        if user.status == "suspended":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "detail": "Merchant is already suspended.",
                    "code": "MERCHANT_ALREADY_SUSPENDED",
                },
            )

        user.status = "suspended"

        await db.execute(
            update(PaymentLink)
            .where(
                and_(
                    PaymentLink.merchant_id == merchant_id,
                    PaymentLink.status == "active",
                )
            )
            .values(status="suspended_by_admin")
        )

        audit = AuditLog(
            event_type="merchant_suspended",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)
        await db.commit()

        return OkResponse(message="Merchant suspended.", code="MERCHANT_SUSPENDED")

    # ------------------------------------------------------------------
    # Unsuspend Merchant (Requirements 14.9, 14.10)
    # ------------------------------------------------------------------

    @staticmethod
    async def unsuspend_merchant(
        db: AsyncSession,
        *,
        admin_id: uuid.UUID,
        merchant_id: uuid.UUID,
    ) -> OkResponse:
        """Unsuspend a merchant account and restore links paused during suspension.

        - Sets ``User.status = 'active'``
        - Bulk-updates PaymentLinks with ``suspended_by_admin`` back to ``active``
          (only those set during the most recent suspension — i.e., currently
          ``suspended_by_admin``)
        - Writes audit log entry
        - All three operations committed in one transaction

        Requirements: 14.9, 14.10
        """
        user_result = await db.execute(
            select(User).where(User.id == merchant_id)
        )
        user: User | None = user_result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
            )

        user.status = "active"

        await db.execute(
            update(PaymentLink)
            .where(
                and_(
                    PaymentLink.merchant_id == merchant_id,
                    PaymentLink.status == "suspended_by_admin",
                )
            )
            .values(status="active")
        )

        audit = AuditLog(
            event_type="merchant_unsuspended",
            actor_id=admin_id,
            target_type="merchant",
            target_id=merchant_id,
            outcome="success",
        )
        db.add(audit)
        await db.commit()

        return OkResponse(message="Merchant unsuspended.", code="MERCHANT_UNSUSPENDED")

    # ------------------------------------------------------------------
    # List Suspended Users (new)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_suspended_users(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
    ) -> PaginatedUsersResponse:
        """Return a paginated list of all suspended users."""
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        base_query = select(User).where(User.status == "suspended")
        count_query = (
            select(func.count()).select_from(User).where(User.status == "suspended")
        )

        total_result = await db.execute(count_query)
        total: int = total_result.scalar_one()

        data_result = await db.execute(
            base_query.order_by(User.updated_at.desc()).offset(offset).limit(page_size)
        )
        users = data_result.scalars().all()

        items = [
            UserListItem(
                id=u.id,
                email=u.email,
                role=u.account_type,
                account_type=u.account_type,
                status=u.status,
                created_at=u.created_at,
            )
            for u in users
        ]
        pages = math.ceil(total / page_size) if total > 0 else 1
        return PaginatedUsersResponse(
            items=items, total=total, page=page, page_size=page_size, pages=pages
        )

    # ------------------------------------------------------------------
    # List Appeals (new)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_appeals(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        status_filter: str | None = None,
    ) -> PaginatedAppealsResponse:
        """Return paginated suspension appeals with optional status filter."""
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)
        offset = (page - 1) * page_size

        base_query = select(SuspensionAppeal)
        count_query = select(func.count()).select_from(SuspensionAppeal)

        if status_filter:
            base_query = base_query.where(SuspensionAppeal.status == status_filter)
            count_query = count_query.where(SuspensionAppeal.status == status_filter)

        total_result = await db.execute(count_query)
        total: int = total_result.scalar_one()

        data_result = await db.execute(
            base_query.order_by(SuspensionAppeal.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        appeals = data_result.scalars().all()

        # Bulk-fetch associated users
        user_ids = [a.user_id for a in appeals]
        users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_map = {u.id: u for u in users_result.scalars().all()}

        items = [
            SuspensionAppealItem(
                id=a.id,
                user_id=a.user_id,
                user_email=users_map[a.user_id].email if a.user_id in users_map else "",
                user_full_name=users_map[a.user_id].full_name if a.user_id in users_map else "",
                suspension_reason=users_map[a.user_id].suspension_reason if a.user_id in users_map else None,
                suspension_message=users_map[a.user_id].suspension_message if a.user_id in users_map else None,
                message=a.message,
                status=a.status,
                admin_note=a.admin_note,
                reviewed_by=a.reviewed_by,
                reviewed_at=a.reviewed_at,
                created_at=a.created_at,
            )
            for a in appeals
        ]

        pages = math.ceil(total / page_size) if total > 0 else 1
        return PaginatedAppealsResponse(
            items=items, total=total, page=page, page_size=page_size, pages=pages
        )

    # ------------------------------------------------------------------
    # Review Appeal (approve / reject)  (new)
    # ------------------------------------------------------------------

    @staticmethod
    async def review_appeal(
        db: AsyncSession,
        *,
        actor_id: uuid.UUID,
        appeal_id: uuid.UUID,
        decision: str,  # "approved" | "rejected"
        admin_note: str | None = None,
    ) -> OkResponse:
        """Approve or reject a suspension appeal.

        Approving an appeal also reactivates the associated user account.
        """
        result = await db.execute(
            select(SuspensionAppeal).where(SuspensionAppeal.id == appeal_id)
        )
        appeal: SuspensionAppeal | None = result.scalar_one_or_none()

        if appeal is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": "Appeal not found.", "code": "APPEAL_NOT_FOUND"},
            )

        if appeal.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "detail": "Appeal has already been reviewed.",
                    "code": "APPEAL_ALREADY_REVIEWED",
                },
            )

        if decision not in ("approved", "rejected"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "detail": "Decision must be 'approved' or 'rejected'.",
                    "code": "INVALID_DECISION",
                },
            )

        now = datetime.now(UTC)
        appeal.status = decision
        appeal.admin_note = admin_note
        appeal.reviewed_by = actor_id
        appeal.reviewed_at = now

        if decision == "approved":
            # Reactivate the user's account
            user_result = await db.execute(
                select(User).where(User.id == appeal.user_id)
            )
            user: User | None = user_result.scalar_one_or_none()
            if user:
                user.status = "active"
                user.suspension_reason = None
                user.suspension_message = None

            db.add(
                AuditLog(
                    event_type="user.appeal.approved",
                    actor_id=actor_id,
                    target_type="user",
                    target_id=appeal.user_id,
                    outcome="success",
                )
            )
        else:
            db.add(
                AuditLog(
                    event_type="user.appeal.rejected",
                    actor_id=actor_id,
                    target_type="user",
                    target_id=appeal.user_id,
                    outcome="success",
                )
            )

        await db.commit()

        msg = "Appeal approved." if decision == "approved" else "Appeal rejected."
        code = "APPEAL_APPROVED" if decision == "approved" else "APPEAL_REJECTED"
        return OkResponse(message=msg, code=code)

    # ------------------------------------------------------------------
    # Global Payer Directory & Merchant Transaction History (Admin)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_global_payers(
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        search: Optional[str] = None,
    ) -> PaginatedAdminPayersResponse:
        """Return platform-wide aggregated payer directory for administrators."""
        page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        page = max(1, page)

        # Load all payments and invoices with merchant user info
        payments_stmt = (
            select(Payment, PaymentLink, User)
            .join(PaymentLink, Payment.payment_link_id == PaymentLink.id)
            .join(User, PaymentLink.merchant_id == User.id)
            .order_by(desc(Payment.created_at))
        )
        payments_rows = (await db.execute(payments_stmt)).all()

        invoices_stmt = (
            select(Invoice, User)
            .join(User, Invoice.merchant_id == User.id)
            .order_by(desc(Invoice.created_at))
        )
        invoices_rows = (await db.execute(invoices_stmt)).all()

        global_map: dict[str, dict[str, Any]] = {}

        for inv, merchant in invoices_rows:
            email = inv.customer_email.strip().lower()
            if not email:
                continue
            inv_dt = _normalize_dt(inv.created_at) or datetime.now(UTC)
            if email not in global_map:
                global_map[email] = {
                    "email": email,
                    "name": inv.customer_name,
                    "merchants": set(),
                    "total_payments": 0,
                    "successful_payments": 0,
                    "pending_payments": 0,
                    "expired_payments": 0,
                    "status_breakdown": {},
                    "total_volume_usd": Decimal("0.00"),
                    "tokens_used": set(),
                    "networks_used": set(),
                    "last_payment_at": None,
                    "first_seen_at": inv_dt,
                }
            g = global_map[email]
            if not g["name"] and inv.customer_name:
                g["name"] = inv.customer_name
            g["merchants"].add(merchant.full_name or merchant.email)
            if inv_dt < g["first_seen_at"]:
                g["first_seen_at"] = inv_dt

        for payment, link, merchant in payments_rows:
            email = (payment.payer_email or "").strip().lower()
            if not email:
                email = f"wallet:{payment.from_address[:8]}...{payment.from_address[-4:]}" if payment.from_address else "anonymous"

            pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
            if email not in global_map:
                global_map[email] = {
                    "email": email,
                    "name": None,
                    "merchants": set(),
                    "total_payments": 0,
                    "successful_payments": 0,
                    "pending_payments": 0,
                    "expired_payments": 0,
                    "status_breakdown": {},
                    "total_volume_usd": Decimal("0.00"),
                    "tokens_used": set(),
                    "networks_used": set(),
                    "last_payment_at": None,
                    "first_seen_at": pay_dt,
                }

            g = global_map[email]
            g["merchants"].add(merchant.full_name or merchant.email)
            g["tokens_used"].add(payment.token_symbol)
            g["networks_used"].add(payment.network)

            g["total_payments"] += 1
            st = payment.status.lower()
            g["status_breakdown"][st] = g["status_breakdown"].get(st, 0) + 1

            usd_dec = _resolve_usd_amount(payment, link, None)
            if st in ["confirmed", "paid"]:
                g["successful_payments"] += 1
                g["total_volume_usd"] += (usd_dec if usd_dec is not None else Decimal(str(payment.amount or 0)))
                if not g["last_payment_at"] or pay_dt > g["last_payment_at"]:
                    g["last_payment_at"] = pay_dt
            elif st == "pending":
                g["pending_payments"] += 1
            elif st == "expired":
                g["expired_payments"] += 1

            if pay_dt < g["first_seen_at"]:
                g["first_seen_at"] = pay_dt

        payer_items: list[AdminGlobalPayerItem] = []
        total_vol = Decimal("0.00")

        for email, data in global_map.items():
            if search:
                q = search.lower()
                if q not in email and (not data["name"] or q not in data["name"].lower()):
                    continue

            total_vol += data["total_volume_usd"]
            payer_items.append(
                AdminGlobalPayerItem(
                    email=data["email"],
                    name=data["name"],
                    merchant_count=len(data["merchants"]),
                    merchants=sorted(list(data["merchants"])),
                    total_payments=data["total_payments"],
                    successful_payments=data.get("successful_payments", 0),
                    pending_payments=data.get("pending_payments", 0),
                    expired_payments=data.get("expired_payments", 0),
                    status_breakdown=data.get("status_breakdown", {}),
                    total_volume_usd=round(data["total_volume_usd"], 2),
                    tokens_used=sorted(list(data["tokens_used"])),
                    networks_used=sorted(list(data["networks_used"])),
                    last_payment_at=data["last_payment_at"],
                    first_seen_at=data["first_seen_at"],
                )
            )

        payer_items.sort(key=lambda x: (x.total_volume_usd, x.successful_payments, x.total_payments), reverse=True)

        total_count = len(payer_items)
        total_pages = max(1, math.ceil(total_count / page_size))
        paginated = payer_items[(page - 1) * page_size : page * page_size]

        return PaginatedAdminPayersResponse(
            items=paginated,
            total=total_count,
            total_volume_usd=round(total_vol, 2),
            page=page,
            page_size=page_size,
            pages=total_pages,
        )

    @staticmethod
    async def get_global_payer_detail(
        payer_email: str,
        db: AsyncSession,
    ) -> AdminPayerDetailResponse:
        """Return platform-wide payer detail, cross-merchant metrics, and full activity logs for admin."""
        clean_email = payer_email.strip().lower()

        # Query all payments across platform matching email or wallet address
        stmt = (
            select(Payment, PaymentLink, User, Invoice)
            .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
            .outerjoin(User, PaymentLink.merchant_id == User.id)
            .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
            .where(
                or_(
                    Payment.payer_email == clean_email,
                    Invoice.customer_email == clean_email,
                )
            )
            .order_by(desc(Payment.created_at))
        )
        rows = (await db.execute(stmt)).all()

        # Query standalone invoices
        inv_stmt = (
            select(Invoice, User)
            .join(User, Invoice.merchant_id == User.id)
            .where(Invoice.customer_email == clean_email)
            .order_by(desc(Invoice.created_at))
        )
        inv_rows = (await db.execute(inv_stmt)).all()

        if not rows and not inv_rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"detail": f"No payer record found for {payer_email}.", "code": "PAYER_NOT_FOUND"},
            )

        customer_name: Optional[str] = None
        merchants: set[str] = set()
        tokens_used: set[str] = set()
        networks_used: set[str] = set()
        first_seen: Optional[datetime] = None
        last_active: Optional[datetime] = None
        total_volume: Decimal = Decimal("0.00")
        successful_count = 0
        pending_count = 0
        expired_count = 0
        status_breakdown: dict[str, int] = {}
        activity_logs: list[PayerActivityLogItem] = []

        for payment, link, merchant, invoice in rows:
            if invoice and invoice.customer_name and not customer_name:
                customer_name = invoice.customer_name
            if merchant:
                merchants.add(merchant.full_name or merchant.email)

            tokens_used.add(payment.token_symbol)
            networks_used.add(payment.network)

            pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
            pay_conf_dt = _normalize_dt(payment.confirmed_at)

            if not first_seen or pay_dt < first_seen:
                first_seen = pay_dt
            if not last_active or pay_dt > last_active:
                last_active = pay_dt

            st = payment.status.lower()
            status_breakdown[st] = status_breakdown.get(st, 0) + 1

            usd_dec = _resolve_usd_amount(payment, link, invoice)
            usd_val = str(round(usd_dec, 2)) if usd_dec is not None else None

            if st in ["confirmed", "paid"]:
                successful_count += 1
                total_volume += (usd_dec if usd_dec is not None else Decimal(str(payment.amount or 0)))
            elif st == "pending":
                pending_count += 1
            elif st == "expired":
                expired_count += 1

            log_type = "Invoice" if payment.invoice_id else "Payment Link"
            log_title = (link.title if link else (f"Invoice #{str(invoice.id)[:8]}" if invoice else "Payment Session"))
            checkout_url = f"/pay/{link.slug}" if link else None

            activity_logs.append(
                PayerActivityLogItem(
                    id=str(payment.id),
                    type=log_type,
                    title=log_title,
                    status=payment.status,
                    amount_crypto=str(payment.amount) if payment.amount else None,
                    token_symbol=payment.token_symbol,
                    network=payment.network,
                    usd_amount=usd_val,
                    tx_hash=payment.tx_hash,
                    created_at=pay_dt,
                    confirmed_at=pay_conf_dt,
                    merchant_name=merchant.full_name if merchant else None,
                    merchant_id=str(merchant.id) if merchant else None,
                    checkout_url=checkout_url,
                )
            )

        for inv, merchant in inv_rows:
            if inv.customer_name and not customer_name:
                customer_name = inv.customer_name
            merchants.add(merchant.full_name or merchant.email)
            inv_dt = _normalize_dt(inv.created_at) or datetime.now(UTC)

            if not first_seen or inv_dt < first_seen:
                first_seen = inv_dt
            if not last_active or inv_dt > last_active:
                last_active = inv_dt

            if inv.payment_link_id and not any(l.id == str(inv.id) for l in activity_logs):
                activity_logs.append(
                    PayerActivityLogItem(
                        id=str(inv.id),
                        type="Invoice",
                        title=f"Invoice #{str(inv.id)[:8]}",
                        status=inv.status,
                        amount_crypto=None,
                        token_symbol=None,
                        network=None,
                        usd_amount=str(inv.total_amount),
                        tx_hash=None,
                        created_at=inv_dt,
                        confirmed_at=None,
                        merchant_name=merchant.full_name,
                        merchant_id=str(merchant.id),
                        checkout_url=None,
                    )
                )

        activity_logs.sort(key=lambda x: _normalize_dt(x.created_at) or datetime.min.replace(tzinfo=UTC), reverse=True)

        return AdminPayerDetailResponse(
            email=clean_email,
            name=customer_name,
            merchant_count=len(merchants),
            merchants=sorted(list(merchants)),
            total_attempts=len(activity_logs),
            successful_payments=successful_count,
            pending_payments=pending_count,
            expired_payments=expired_count,
            total_volume_usd=round(total_volume, 2),
            tokens_used=sorted(list(tokens_used)),
            networks_used=sorted(list(networks_used)),
            first_seen_at=first_seen or datetime.now(UTC),
            last_active_at=last_active,
            status_breakdown=status_breakdown,
            activity_logs=activity_logs,
        )

    @staticmethod
    async def list_merchant_payers(
        merchant_id: uuid.UUID,
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        search: Optional[str] = None,
    ) -> PayerDirectoryResponse:
        """Return payer directory for a specific merchant."""
        from app.merchant.service import list_merchant_payers as _m_payers
        return await _m_payers(merchant_id, db, page=page, page_size=page_size, search=search)

    @staticmethod
    async def list_merchant_transactions(
        merchant_id: uuid.UUID,
        db: AsyncSession,
        *,
        page: int = 1,
        page_size: int = _DEFAULT_PAGE_SIZE,
        status_filter: Optional[str] = None,
    ) -> TransactionListResponse:
        """Return transaction history for a specific merchant."""
        from app.merchant.service import list_merchant_transactions as _m_txs
        return await _m_txs(merchant_id, db, page=page, page_size=page_size, status_filter=status_filter)

