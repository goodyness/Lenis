"""
FastAPI router for the EVM networks module.

Registers a single unauthenticated endpoint:

- ``GET /networks`` — returns the list of active EVM networks and their
  supported tokens, as configured via environment variables at startup.

No authentication is required.  The response is derived entirely from the
in-memory ``NetworkRegistry`` singleton, so it has no database dependency
and is safe to call at high frequency.

Requirements: 7.7
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.networks import network_registry

router = APIRouter()


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class TokenResponse(BaseModel):
    """A single token supported on a given network."""

    symbol: str
    contract_address: str | None  # None for native tokens (ETH, MATIC, BNB)

    model_config = {"from_attributes": True}


class NetworkResponse(BaseModel):
    """A single active EVM network with its supported tokens."""

    display_name: str
    chain_id: int
    native_symbol: str
    tokens: list[TokenResponse]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/networks",
    response_model=list[NetworkResponse],
    summary="List active EVM networks and supported tokens",
    description=(
        "Returns all EVM networks that were successfully configured at "
        "application startup (i.e. their RPC URL env var is non-empty). "
        "Each network entry includes the display name, chain ID, native token "
        "symbol, and a list of supported tokens with their contract addresses "
        "('null' for native tokens). "
        "Tokens whose contract address env var was missing at startup are "
        "excluded from the response. "
        "No authentication required. "
        "Requirements: 7.7"
    ),
    tags=["networks"],
)
async def list_networks() -> list[NetworkResponse]:
    """Return the list of active EVM networks and their supported tokens.

    The response is built from the in-memory ``NetworkRegistry`` singleton
    that is populated once at application startup from environment variables.
    Networks with a missing RPC URL and tokens with a missing contract address
    are silently excluded (a warning is logged at startup).
    """
    return [
        NetworkResponse(
            display_name=net.display_name,
            chain_id=net.chain_id,
            native_symbol=net.native_symbol,
            tokens=[
                TokenResponse(
                    symbol=token.symbol,
                    contract_address=token.contract_address,
                )
                for token in net.tokens
            ],
        )
        for net in network_registry.get_active_networks()
    ]
