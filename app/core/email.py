"""
Email client and Celery task for the Lenis platform.

``EmailClient`` sends transactional email via SMTP using the settings defined
in ``app.core.config``. The ``send_email_task`` Celery task wraps the client
so email delivery is always performed asynchronously out of the request cycle.

Template rendering uses Jinja2. Plain-HTML templates live in
``app/core/templates/email/``. Each template receives the *context* dict as
its variable namespace.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.celery_app import celery_app
from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Jinja2 template environment
# ---------------------------------------------------------------------------

_TEMPLATE_DIR = Path(__file__).parent / "templates" / "email"

_jinja_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    autoescape=select_autoescape(["html"]),
    auto_reload=False,
)


# ---------------------------------------------------------------------------
# EmailClient
# ---------------------------------------------------------------------------


class EmailClient:
    """Thin wrapper around stdlib ``smtplib`` for sending HTML emails.

    Instantiated once per Celery task execution so there is no shared
    connection state between tasks.
    """

    def send(
        self,
        to: str,
        subject: str,
        template: str,
        context: dict[str, Any],
    ) -> None:
        """Send a single HTML email.

        Parameters
        ----------
        to:
            Recipient email address.
        subject:
            Email subject line.
        template:
            Template filename (without extension) under
            ``app/core/templates/email/``.  E.g. ``"email_verification"``
            loads ``email_verification.html``.
        context:
            Variables passed to the Jinja2 template.
        """
        html_body = self._render(template, context)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_address}>"
        msg["To"] = to
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        self._send_smtp(to, msg)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _render(self, template: str, context: dict[str, Any]) -> str:
        """Render *template*.html with *context* and return the HTML string.

        Falls back to a plain-text representation when the template file does
        not exist yet, so the task does not hard-fail during development before
        templates are created.
        """
        try:
            tmpl = _jinja_env.get_template(f"{template}.html")
            return tmpl.render(**context)
        except Exception:
            # Fallback: emit a minimal HTML body so delivery still works.
            logger.warning(
                "Template '%s.html' not found or failed to render; using fallback.",
                template,
            )
            lines = "\n".join(f"<p><b>{k}:</b> {v}</p>" for k, v in context.items())
            return f"<html><body>{lines}</body></html>"

    def _send_smtp(self, to: str, msg: MIMEMultipart) -> None:
        """Deliver *msg* to *to* via SMTP, or log to console in development.

        When ``SMTP_HOST`` is ``localhost`` or empty (the default dev setting),
        the email is printed to the console instead of attempting a real
        SMTP connection. This lets registration and password-reset flows work
        in development without any mail server.
        """
        dev_mode = not settings.smtp_host or settings.smtp_host == "localhost"
        if dev_mode and settings.app_env == "development":
            # Extract plain-text URLs from the HTML body for easy copy-paste
            import base64, re  # noqa: PLC0415, E401
            url_lines: list[str] = []
            for part in msg.walk():
                payload = part.get_payload(decode=True)
                if payload:
                    html = payload.decode("utf-8", errors="replace")
                    for url in re.findall(r'href="(http[^"]+)"', html):
                        url_lines.append(f"  {url}")
            url_section = (
                "\n[DEV EMAIL LINKS]\n" + "\n".join(url_lines)
                if url_lines
                else ""
            )
            logger.info(
                "[DEV EMAIL] To: %s | Subject: %s%s",
                msg["To"],
                msg["Subject"],
                url_section,
            )
            return

        use_ssl = settings.smtp_tls or settings.smtp_port == 465
        use_starttls = settings.smtp_start_tls or settings.smtp_port == 587

        if use_ssl:
            connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
        else:
            connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            if use_starttls:
                connection.starttls()

        with connection:
            if settings.smtp_user and settings.smtp_pass:
                connection.login(settings.smtp_user, settings.smtp_pass)
            connection.sendmail(
                settings.smtp_from_address,
                [to],
                msg.as_string(),
            )


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="app.core.email.send_email_task",
    max_retries=3,
    default_retry_delay=60,
)
def send_email_task(
    self: Any,
    to: str,
    subject: str,
    template: str,
    context: dict[str, Any],
) -> None:
    """Celery task that delivers a single email.

    Retries up to 3 times with a 60-second delay between attempts on any
    SMTP or rendering failure.  Uses ``self.retry(exc=exc)`` so the original
    exception is preserved in the result backend.

    Parameters
    ----------
    to:
        Recipient address.
    subject:
        Email subject line.
    template:
        Template name passed through to :meth:`EmailClient.send`.
    context:
        Template context variables.
    """
    client = EmailClient()
    try:
        client.send(to=to, subject=subject, template=template, context=context)
    except Exception as exc:
        logger.error(
            "send_email_task failed (attempt %d/%d): %s",
            self.request.retries + 1,
            self.max_retries + 1,
            exc,
        )
        if self.request.retries >= self.max_retries:
            import redis as sync_redis
            import json
            import uuid as _uuid
            key = f"email_dead_letter:{_uuid.uuid4()}"
            r = sync_redis.from_url(settings.redis_url)
            r.set(key, json.dumps({"to": to, "subject": subject, "template": template, "context": context}))
            logger.critical("Email dead-lettered at key %s for recipient %s", key, to)
        raise self.retry(exc=exc)
