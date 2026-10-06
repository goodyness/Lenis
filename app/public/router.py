"""
FastAPI router for public-facing endpoints.

Exposes unauthenticated endpoints such as the contact form.  This router
carries no prefix itself; the route paths include the full versioned path
(e.g. ``/v1/contact``).

Requirements: 17.6, 17.7, 17.8
"""
from __future__ import annotations

from fastapi import APIRouter

from app.core.config import settings
from app.core.email import send_email_task
from app.public.schemas import ContactFormRequest, ContactFormResponse

router = APIRouter()


@router.post("/v1/contact", response_model=ContactFormResponse)
async def submit_contact_form(data: ContactFormRequest) -> ContactFormResponse:
    """Accept a public contact form submission and enqueue a notification email.

    Validates:
    - ``name``: 1–100 characters (non-empty string)
    - ``email``: valid email address
    - ``message``: 1–2000 characters (non-empty string)

    On valid input the endpoint enqueues an email to the platform support
    address via Celery and returns HTTP 200 with a confirmation message.

    On invalid input FastAPI raises HTTP 422 automatically with field-level
    error details before this handler is ever called.

    Requirements: 17.7, 17.8
    """
    body = (
        f"Name:    {data.name}\n"
        f"Email:   {data.email}\n"
        f"Message:\n{data.message}"
    )

    send_email_task.delay(
        to=settings.smtp_from_address,
        subject=f"Contact Form: {data.name}",
        template="contact_form",
        context={
            "sender_name": data.name,
            "sender_email": data.email,
            "message": data.message,
            "body": body,
        },
    )

    return ContactFormResponse(
        success=True,
        message="Your message has been sent. We'll get back to you soon.",
    )
