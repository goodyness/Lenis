"""
Pydantic schemas for the public-facing API endpoints.

Requirements: 17.6, 17.7, 17.8
"""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class ContactFormRequest(BaseModel):
    """Validated payload for the public contact form."""

    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    message: str = Field(..., min_length=1, max_length=2000)


class ContactFormResponse(BaseModel):
    """Response returned after a successful contact form submission."""

    success: bool
    message: str
