"""
Structured JSON logging configuration for the Lenis platform.

In production, configures the root logger to emit JSON-formatted log records
using ``python-json-logger``. A ``RequestContextFilter`` injects request-scoped
fields (request_id, path, method, status_code, duration_ms) into every record
so they appear in the JSON output automatically.

In non-production environments this module is a deliberate no-op — Python's
default logging is left untouched to preserve dev-friendly coloured output.
"""
from __future__ import annotations

import logging


class RequestContextFilter(logging.Filter):
    """Inject request-scoped fields into every log record.

    Fields are optional: if not set on the record they default to ``None``
    so the JSON output always includes the keys (making log queries stable).
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        record.request_id = getattr(record, "request_id", None)
        record.path = getattr(record, "path", None)
        record.method = getattr(record, "method", None)
        record.status_code = getattr(record, "status_code", None)
        record.duration_ms = getattr(record, "duration_ms", None)
        return True


def configure_logging(app_env: str) -> None:
    """Configure root-level logging based on the current environment.

    Args:
        app_env: The application environment string (e.g. ``"production"``,
                 ``"development"``, ``"test"``).

    Production behaviour:
        - Replaces all root handlers with a single ``StreamHandler`` that
          emits JSON via ``JsonFormatter``.
        - Sets root log level to ``WARNING`` (errors and above) to reduce
          noise in production log aggregators.
        - Attaches ``RequestContextFilter`` so request-correlated fields are
          always present in JSON output.

    Non-production behaviour:
        - No-op. Python's default logging configuration is preserved so
          developers see readable, coloured output in their terminals.
    """
    if app_env != "production":
        return

    from pythonjsonlogger.jsonlogger import JsonFormatter  # type: ignore[import-untyped]

    handler = logging.StreamHandler()
    formatter = JsonFormatter(
        fmt=(
            "%(asctime)s %(levelname)s %(name)s %(message)s "
            "%(request_id)s %(path)s %(method)s %(status_code)s %(duration_ms)s"
        ),
        datefmt="%Y-%m-%dT%H:%M:%S+00:00",
    )
    handler.setFormatter(formatter)
    handler.addFilter(RequestContextFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.WARNING)
