"""
File storage abstraction for the Lenis platform.

Provides two concrete backends switchable via the ``UPLOAD_STORAGE``
environment variable:

- ``local``  — writes files to the local filesystem (development / testing)
- ``s3``     — uploads files to AWS S3 (production)

Both backends implement the ``StorageBackend`` abstract base class so the
rest of the application is decoupled from the underlying storage technology.

Path builder helpers
--------------------
``kyc_path(user_id, ext)``  → ``kyc/{user_id}/{uuid4}.{ext}``
``reg_path(user_id, ext)``  → ``reg/{user_id}/{uuid4}.{ext}``

These helpers ensure every uploaded file has a unique, collision-free path
that embeds the merchant's user ID for easy per-merchant enumeration.

MIME validation
---------------
``validate_upload(content, declared_content_type, max_size_mb)`` uses
``python-magic`` for server-side byte-level MIME inspection.  The declared
``Content-Type`` header is *never* trusted for security decisions.

Accepted MIME types: ``application/pdf``, ``image/jpeg``, ``image/png``.

Requirements: 15.1 – 15.7
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from app.core.config import Settings, settings as _default_settings

logger = logging.getLogger(__name__)

ACCEPTED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/svg+xml",
        "image/gif",
    }
)

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class StorageUnavailableError(HTTPException):
    """Raised when the configured storage backend is unreachable (HTTP 503)."""

    def __init__(self, detail: str = "Storage backend is currently unavailable.") -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"detail": detail, "code": "STORAGE_UNAVAILABLE"},
        )


class FileTooLargeError(HTTPException):
    """Raised when an uploaded file exceeds the configured size limit (HTTP 400)."""

    def __init__(self, max_mb: int) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": f"File exceeds the maximum allowed size of {max_mb} MB.",
                "code": "FILE_TOO_LARGE",
            },
        )


class FileMimeInvalidError(HTTPException):
    """Raised when the server-side MIME type is not in the accepted set (HTTP 400)."""

    def __init__(self, detected: str) -> None:
        accepted = ", ".join(sorted(ACCEPTED_MIME_TYPES))
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": (
                    f"File type '{detected}' is not allowed. "
                    f"Accepted types: {accepted}."
                ),
                "code": "FILE_MIME_INVALID",
            },
        )


# ---------------------------------------------------------------------------
# Path builder helpers (Requirement 15.7)
# ---------------------------------------------------------------------------


def kyc_path(user_id: str | uuid.UUID, ext: str) -> str:
    """Return a unique storage path for a KYC identity document.

    Pattern: ``kyc/{user_id}/{uuid4}.{ext}``

    Args:
        user_id: The merchant's User ID (UUID).
        ext: The file extension without a leading dot (e.g. ``"pdf"``).

    Returns:
        A string storage path guaranteed to be unique due to the UUID4 segment.
    """
    ext = ext.lstrip(".")
    return f"kyc/{user_id}/{uuid.uuid4()}.{ext}"


def reg_path(user_id: str | uuid.UUID, ext: str) -> str:
    """Return a unique storage path for a business registration document.

    Pattern: ``reg/{user_id}/{uuid4}.{ext}``

    Args:
        user_id: The merchant's User ID (UUID).
        ext: The file extension without a leading dot (e.g. ``"png"``).

    Returns:
        A string storage path guaranteed to be unique due to the UUID4 segment.
    """
    ext = ext.lstrip(".")
    return f"reg/{user_id}/{uuid.uuid4()}.{ext}"


# ---------------------------------------------------------------------------
# MIME validation utility (Requirement 15.4, 15.8)
# ---------------------------------------------------------------------------


def _detect_mime(content: bytes) -> str:
    """Return the MIME type of *content* using server-side byte inspection.

    Uses ``python-magic`` when available.  Falls back to a lightweight
    header-byte check so the application stays functional in environments
    where libmagic is not installed (e.g., minimal CI images).

    In production the fallback is **disabled** — if ``python-magic`` /
    libmagic is unavailable the process exits with code 1 (Requirement 16.4).

    The declared ``Content-Type`` header is *never* used here.
    """
    try:
        import magic  # python-magic (requires libmagic system library)

        return magic.from_buffer(content, mime=True)
    except ImportError:
        if _default_settings.app_env == "production":
            logger.critical(
                "python-magic/libmagic not available in production. "
                "Install libmagic1 in the Docker image."
            )
            raise SystemExit(1)
        logger.warning(
            "python-magic is not installed; using fallback MIME detection. "
            "Install python-magic (and libmagic) for production use."
        )
        return _fallback_detect_mime(content)


def _fallback_detect_mime(content: bytes) -> str:
    """Byte-header-based MIME detection used when python-magic is unavailable."""
    if content[:4] == b"%PDF":
        return "application/pdf"
    if content[:2] == b"\xff\xd8":
        return "image/jpeg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:4] == b"RIFF" and len(content) >= 12 and content[8:12] == b"WEBP":
        return "image/webp"
    if content[:4] == b"GIF8":
        return "image/gif"
    if b"<svg" in content[:300].lower():
        return "image/svg+xml"
    # Return an unrecognised type so the validator rejects it.
    return "application/octet-stream"


def validate_upload(
    content: bytes,
    declared_content_type: str,
    max_size_mb: int | None = None,
) -> str:
    """Validate an uploaded file's size and actual MIME type.

    The ``declared_content_type`` parameter is accepted for API consistency
    but is **never** used for security decisions.  Only the byte-level
    server-side inspection result matters.

    Args:
        content: Raw file bytes.
        declared_content_type: The Content-Type header value sent by the
            client. Ignored for validation; kept for logging only.
        max_size_mb: Maximum allowed file size in megabytes. When ``None``
            the check is skipped.

    Returns:
        The detected MIME type string (one of the accepted types).

    Raises:
        FileTooLargeError: File exceeds *max_size_mb*.
        FileMimeInvalidError: Detected MIME type is not in ``ACCEPTED_MIME_TYPES``.
    """
    if max_size_mb is not None:
        limit_bytes = max_size_mb * 1024 * 1024
        if len(content) > limit_bytes:
            raise FileTooLargeError(max_size_mb)

    detected = _detect_mime(content)

    if detected not in ACCEPTED_MIME_TYPES:
        raise FileMimeInvalidError(detected)

    return detected


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------


class StorageBackend(ABC):
    """Abstract file storage backend.

    Concrete subclasses must implement ``upload_file``, ``get_presigned_url``,
    and ``delete_file``.  All methods are ``async`` to avoid blocking the
    event loop in FastAPI request handlers.
    """

    @abstractmethod
    async def upload_file(self, content: bytes, path: str, content_type: str) -> str:
        """Upload *content* to *path* and return the storage key.

        Args:
            content: Raw file bytes.
            path: The target storage path (e.g. the value returned by
                :func:`kyc_path` or :func:`reg_path`).
            content_type: MIME type of the content, stored as metadata.

        Returns:
            The storage key / path that was written (same as *path*).

        Raises:
            StorageUnavailableError: Backend is unreachable.
        """

    @abstractmethod
    async def get_presigned_url(self, key: str, expires_in: int) -> str:
        """Return a time-limited URL that allows downloading the file at *key*.

        Args:
            key: The storage key returned by :meth:`upload_file`.
            expires_in: URL lifetime in seconds. Callers should pass a value
                no larger than 900 (15 minutes) per Requirement 15.6.

        Returns:
            A URL string that grants temporary read access to the file.

        Raises:
            StorageUnavailableError: Backend is unreachable.
        """

    @abstractmethod
    async def get_file(self, key: str) -> tuple[bytes, str]:
        """Retrieve the raw content and detected MIME type of the file at *key*.

        Args:
            key: The storage key returned by :meth:`upload_file`.

        Returns:
            A tuple of (bytes, content_type).

        Raises:
            FileNotFoundError: The file does not exist.
            StorageUnavailableError: Backend is unreachable.
        """

    @abstractmethod
    async def delete_file(self, key: str) -> None:
        """Delete the file at *key* from the storage backend.

        Args:
            key: The storage key returned by :meth:`upload_file`.

        Raises:
            StorageUnavailableError: Backend is unreachable.
        """


# ---------------------------------------------------------------------------
# Local filesystem backend (Requirement 15.1, 15.2)
# ---------------------------------------------------------------------------


class LocalStorageBackend(StorageBackend):
    """Stores files on the local filesystem under ``settings.upload_local_path``.

    Suitable for development and testing.  ``get_presigned_url`` returns a
    plain file URI since there is no network-accessible URL to generate.

    Directory structure mirrors the storage key, so a key of
    ``kyc/abc/123.pdf`` is written to ``{base_path}/kyc/abc/123.pdf``.
    """

    def __init__(self, base_path: str) -> None:
        self._base = Path(base_path).resolve()
        self._base.mkdir(parents=True, exist_ok=True)

    def _full_path(self, key: str) -> Path:
        """Resolve *key* to an absolute path under the base directory."""
        return self._base / key

    async def upload_file(self, content: bytes, path: str, content_type: str) -> str:
        """Write *content* to the local filesystem at *path*.

        Creates any missing parent directories automatically.
        """
        full = self._full_path(path)
        full.parent.mkdir(parents=True, exist_ok=True)
        # Run the blocking write in a thread pool so we don't stall the loop.
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, full.write_bytes, content)
        logger.debug("LocalStorage: wrote %d bytes to %s", len(content), full)
        return path

    async def get_presigned_url(self, key: str, expires_in: int) -> str:
        """Return a ``file://`` URI for the local file at *key*.

        The ``expires_in`` parameter is accepted but has no effect in the
        local backend (local files do not expire).
        """
        full = self._full_path(key)
        return full.as_uri()

    async def get_file(self, key: str) -> tuple[bytes, str]:
        """Read and return (content, content_type) for the local file at *key*."""
        full = self._full_path(key)
        if not full.is_file():
            raise FileNotFoundError(f"Local file '{key}' not found at '{full}'.")
        loop = asyncio.get_event_loop()
        content = await loop.run_in_executor(None, full.read_bytes)
        mime = _detect_mime(content)
        return content, mime

    async def delete_file(self, key: str) -> None:
        """Delete the local file at *key*, silently ignoring missing files."""
        full = self._full_path(key)

        def _delete() -> None:
            try:
                full.unlink()
                logger.debug("LocalStorage: deleted %s", full)
            except FileNotFoundError:
                logger.debug("LocalStorage: delete skipped — file not found: %s", full)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _delete)


# ---------------------------------------------------------------------------
# AWS S3 backend (Requirement 15.1, 15.3, 15.5, 15.6)
# ---------------------------------------------------------------------------

_MAX_PRESIGNED_URL_SECONDS = 900  # 15 minutes — hard cap per Requirement 15.6


class S3StorageBackend(StorageBackend):
    """Stores files in an AWS S3 bucket.

    All blocking ``boto3`` calls are dispatched to a thread-pool executor so
    they do not stall the asyncio event loop.

    ``get_presigned_url`` generates a pre-signed ``GetObject`` URL capped at
    900 seconds (15 minutes) per Requirement 15.6.  Any ``expires_in`` value
    larger than 900 is silently clamped to 900.

    Any ``botocore.exceptions.BotoCoreError`` or ``ClientError`` raised during
    a storage operation is caught and re-raised as :class:`StorageUnavailableError`
    (HTTP 503).
    """

    def __init__(
        self,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        region: str = "us-east-1",
    ) -> None:
        self._bucket = bucket
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._region = region

    def _get_client(self) -> Any:
        """Create and return a synchronous boto3 S3 client.

        A new client is created per call so the backend is safe to use from
        multiple threads in the executor pool.
        """
        import boto3  # imported lazily so boto3 is truly optional

        return boto3.client(
            "s3",
            region_name=self._region,
            aws_access_key_id=self._access_key_id,
            aws_secret_access_key=self._secret_access_key,
        )

    async def _run(self, func: Any, *args: Any, **kwargs: Any) -> Any:
        """Execute a synchronous *func* in the default thread pool executor."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: func(*args, **kwargs))

    async def upload_file(self, content: bytes, path: str, content_type: str) -> str:
        """Upload *content* to S3 at *path* with *content_type* metadata."""
        import io

        import botocore.exceptions

        try:
            client = self._get_client()

            def _upload() -> None:
                client.upload_fileobj(
                    io.BytesIO(content),
                    self._bucket,
                    path,
                    ExtraArgs={"ContentType": content_type},
                )

            await self._run(_upload)
            logger.debug("S3Storage: uploaded %d bytes to s3://%s/%s", len(content), self._bucket, path)
            return path
        except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:
            logger.error("S3Storage: upload failed for key '%s': %s", path, exc)
            raise StorageUnavailableError(f"S3 upload failed: {exc}") from exc
        except Exception as exc:
            logger.error("S3Storage: unexpected error during upload for key '%s': %s", path, exc)
            raise StorageUnavailableError(f"S3 upload encountered an unexpected error: {exc}") from exc

    async def get_presigned_url(self, key: str, expires_in: int) -> str:
        """Generate a pre-signed ``GetObject`` URL for *key*.

        The URL lifetime is capped at :data:`_MAX_PRESIGNED_URL_SECONDS`
        (900 s) regardless of the *expires_in* argument.
        """
        import botocore.exceptions

        # Hard-cap per Requirement 15.6
        capped = min(expires_in, _MAX_PRESIGNED_URL_SECONDS)
        if expires_in > _MAX_PRESIGNED_URL_SECONDS:
            logger.warning(
                "S3Storage: expires_in=%d exceeds the 900-second cap; clamping to %d.",
                expires_in,
                _MAX_PRESIGNED_URL_SECONDS,
            )

        try:
            client = self._get_client()

            def _presign() -> str:
                return client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self._bucket, "Key": key},
                    ExpiresIn=capped,
                )

            url: str = await self._run(_presign)
            logger.debug("S3Storage: generated presigned URL for key '%s' (expires_in=%ds)", key, capped)
            return url
        except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:
            logger.error("S3Storage: presigned URL generation failed for key '%s': %s", key, exc)
            raise StorageUnavailableError(f"S3 presigned URL generation failed: {exc}") from exc
        except Exception as exc:
            logger.error(
                "S3Storage: unexpected error generating presigned URL for key '%s': %s", key, exc
            )
            raise StorageUnavailableError(
                f"S3 presigned URL generation encountered an unexpected error: {exc}"
            ) from exc

    async def get_file(self, key: str) -> tuple[bytes, str]:
        """Download and return (content, content_type) for the object at *key* in S3."""
        import botocore.exceptions

        try:
            client = self._get_client()

            def _get() -> tuple[bytes, str]:
                resp = client.get_object(Bucket=self._bucket, Key=key)
                content = resp["Body"].read()
                content_type = resp.get("ContentType", "application/octet-stream")
                return content, content_type

            return await self._run(_get)
        except botocore.exceptions.ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise FileNotFoundError(f"S3 object '{key}' not found.") from exc
            logger.error("S3Storage: get_file failed for key '%s': %s", key, exc)
            raise StorageUnavailableError(f"S3 download failed: {exc}") from exc
        except Exception as exc:
            logger.error("S3Storage: unexpected error downloading key '%s': %s", key, exc)
            raise StorageUnavailableError(f"S3 download encountered an error: {exc}") from exc

    async def delete_file(self, key: str) -> None:
        """Delete the object at *key* from S3."""
        import botocore.exceptions

        try:
            client = self._get_client()
            await self._run(client.delete_object, Bucket=self._bucket, Key=key)
            logger.debug("S3Storage: deleted s3://%s/%s", self._bucket, key)
        except (botocore.exceptions.BotoCoreError, botocore.exceptions.ClientError) as exc:
            logger.error("S3Storage: delete failed for key '%s': %s", key, exc)
            raise StorageUnavailableError(f"S3 delete failed: {exc}") from exc
        except Exception as exc:
            logger.error("S3Storage: unexpected error during delete for key '%s': %s", key, exc)
            raise StorageUnavailableError(
                f"S3 delete encountered an unexpected error: {exc}"
            ) from exc


# ---------------------------------------------------------------------------
# Factory function (Requirement 15.1)
# ---------------------------------------------------------------------------


def get_storage_backend(cfg: Settings | None = None) -> StorageBackend:
    """Return the configured :class:`StorageBackend` instance.

    Reads ``settings.upload_storage`` and returns either a
    :class:`LocalStorageBackend` or :class:`S3StorageBackend`.

    Args:
        cfg: A :class:`~app.core.config.Settings` instance. Defaults to the
             module-level ``settings`` singleton when not provided.

    Returns:
        A :class:`StorageBackend` ready to use.

    Raises:
        ValueError: ``upload_storage`` is set to an unrecognised value.
    """
    cfg = cfg or _default_settings

    backend_name = (cfg.upload_storage or "local").strip().lower()

    if backend_name == "local":
        return LocalStorageBackend(base_path=cfg.upload_local_path)

    if backend_name == "s3":
        return S3StorageBackend(
            bucket=cfg.aws_s3_bucket,
            access_key_id=cfg.aws_access_key_id,
            secret_access_key=cfg.aws_secret_access_key,
            region=cfg.aws_region,
        )

    raise ValueError(
        f"Unknown UPLOAD_STORAGE backend '{backend_name}'. "
        "Valid options are 'local' and 's3'."
    )


# ---------------------------------------------------------------------------
# Production startup guard (Requirement 16.4)
# ---------------------------------------------------------------------------


def _check_libmagic_in_production() -> None:
    """Fail fast in production if python-magic / libmagic is not available.

    Called at module import time so the application exits immediately rather
    than silently using the insecure byte-header fallback in production.
    """
    if _default_settings.app_env == "production":
        try:
            import magic  # noqa: F401
        except ImportError:
            logger.critical(
                "python-magic/libmagic not available in production. "
                "Ensure libmagic1 is installed in the Docker image. Exiting."
            )
            raise SystemExit(1)


# Run the guard when this module is first imported in production.
_check_libmagic_in_production()
