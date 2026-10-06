"""
EVM network and token configuration registry.

Supported networks and their ERC-20 token contract addresses are loaded once
at application startup from the ``Settings`` object (which reads from env
vars / .env file).  Any network whose RPC URL is absent is silently excluded
with a logged warning; any ERC-20 token whose contract address is absent is
excluded from its parent network with a logged warning.  Native tokens (ETH,
MATIC, BNB) are always included with ``contract_address = None``.

The module-level singleton ``network_registry`` is the single point of
access for the rest of the application.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from app.core.config import Settings, settings as _default_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data-transfer objects
# ---------------------------------------------------------------------------


@dataclass
class TokenConfig:
    """Configuration for a single token on a network."""

    symbol: str
    contract_address: str | None  # None for native tokens (ETH, MATIC, BNB)


@dataclass
class NetworkConfig:
    """Configuration for a single EVM-compatible network."""

    chain_id: int
    display_name: str
    native_symbol: str
    rpc_url: str
    confirmation_count: int
    block_time_seconds: int
    tokens: list[TokenConfig] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


# Mapping from mainnet chain_id to its testnet equivalent chain_id.
# Used for testnet isolation in the payment state machine (Req 9.2, 9.3).
TESTNET_CHAIN_MAP: dict[int, int] = {
    1: 11155111,   # Ethereum Mainnet → Sepolia
    8453: 84532,   # Base → Base Sepolia
    137: 80001,    # Polygon → Mumbai
    42161: 421614, # Arbitrum One → Arbitrum Sepolia
    10: 11155420,  # Optimism → Optimism Sepolia
}


class NetworkRegistry:
    """Reads network/token configuration from ``Settings`` at construction time.

    After construction the registry is immutable — a new instance must be
    created to pick up configuration changes (which only happens at startup).
    """

    def __init__(self, cfg: Settings) -> None:
        self._networks: list[NetworkConfig] = []
        self._by_chain_id: dict[int, NetworkConfig] = {}
        self._build(cfg)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_active_networks(self) -> list[NetworkConfig]:
        """Return all networks that were successfully configured at startup."""
        return list(self._networks)

    def get_network_by_id(self, chain_id: int) -> NetworkConfig | None:
        """Return the ``NetworkConfig`` for *chain_id*, or ``None`` if unknown."""
        return self._by_chain_id.get(chain_id)

    def get_supported_tokens(self, chain_id: int) -> list[TokenConfig]:
        """Return the token list for *chain_id*, or an empty list if unknown."""
        network = self._by_chain_id.get(chain_id)
        return list(network.tokens) if network else []

    def get_testnet_equivalent(self, mainnet_chain_id: int) -> NetworkConfig | None:
        """Return the testnet ``NetworkConfig`` for a given mainnet *chain_id*.

        Uses ``TESTNET_CHAIN_MAP`` to resolve the testnet chain ID, then looks
        up the corresponding ``NetworkConfig`` in the registry.  Returns
        ``None`` if the mainnet chain has no known testnet mapping or if the
        testnet network has not been configured (no RPC URL).

        Requirements: 9.2, 9.3
        """
        testnet_id = TESTNET_CHAIN_MAP.get(mainnet_chain_id)
        if testnet_id is None:
            return None
        return self._by_chain_id.get(testnet_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build(self, cfg: Settings) -> None:  # noqa: C901
        """Populate the internal network list from *cfg*."""

        # ----------------------------------------------------------------
        # Network descriptor table
        # Each entry: (attr_name_for_rpc, chain_id, display_name,
        #              native_symbol, confirmation_count, block_time_seconds,
        #              [(token_symbol, attr_name_for_contract), ...])
        # Native tokens are represented as (symbol, None) — no contract lookup.
        # ----------------------------------------------------------------
        network_specs = [
            (
                "ethereum_rpc_url",
                1,
                "Ethereum Mainnet",
                "ETH",
                6,
                12,
                [
                    ("ETH", None),
                    ("USDC", "ethereum_usdc_contract"),
                    ("USDT", "ethereum_usdt_contract"),
                    ("DAI", "ethereum_dai_contract"),
                ],
            ),
            (
                "base_rpc_url",
                8453,
                "Base",
                "ETH",
                3,
                2,
                [
                    ("ETH", None),
                    ("USDC", "base_usdc_contract"),
                    ("USDT", "base_usdt_contract"),
                ],
            ),
            (
                "polygon_rpc_url",
                137,
                "Polygon",
                "MATIC",
                3,
                2,
                [
                    ("MATIC", None),
                    ("USDC", "polygon_usdc_contract"),
                    ("USDT", "polygon_usdt_contract"),
                    ("DAI", "polygon_dai_contract"),
                ],
            ),
            (
                "arbitrum_rpc_url",
                42161,
                "Arbitrum One",
                "ETH",
                3,
                1,
                [
                    ("ETH", None),
                    ("USDC", "arbitrum_usdc_contract"),
                    ("USDT", "arbitrum_usdt_contract"),
                    ("DAI", "arbitrum_dai_contract"),
                ],
            ),
            (
                "optimism_rpc_url",
                10,
                "Optimism",
                "ETH",
                3,
                2,
                [
                    ("ETH", None),
                    ("USDC", "optimism_usdc_contract"),
                    ("USDT", "optimism_usdt_contract"),
                    ("DAI", "optimism_dai_contract"),
                ],
            ),
            (
                "bsc_rpc_url",
                56,
                "BNB Smart Chain",
                "BNB",
                12,
                3,
                [
                    ("BNB", None),
                    ("USDC", "bsc_usdc_contract"),
                    ("USDT", "bsc_usdt_contract"),
                ],
            ),
        ]

        for rpc_attr, chain_id, display_name, native_symbol, confirmations, block_time, token_specs in network_specs:
            rpc_url: str = getattr(cfg, rpc_attr, "") or ""
            if not rpc_url.strip():
                logger.warning(
                    "NetworkRegistry: RPC URL for '%s' (chain_id=%d) is not configured "
                    "(env var: %s). Network excluded from active list.",
                    display_name,
                    chain_id,
                    rpc_attr.upper(),
                )
                continue

            tokens: list[TokenConfig] = []
            for symbol, contract_attr in token_specs:
                if contract_attr is None:
                    # Native token — always included, no contract address.
                    tokens.append(TokenConfig(symbol=symbol, contract_address=None))
                else:
                    contract: str = getattr(cfg, contract_attr, "") or ""
                    if not contract.strip():
                        logger.warning(
                            "NetworkRegistry: Contract address for %s on '%s' is not configured "
                            "(env var: %s). Token excluded.",
                            symbol,
                            display_name,
                            contract_attr.upper(),
                        )
                    else:
                        tokens.append(TokenConfig(symbol=symbol, contract_address=contract))

            network = NetworkConfig(
                chain_id=chain_id,
                display_name=display_name,
                native_symbol=native_symbol,
                rpc_url=rpc_url,
                confirmation_count=confirmations,
                block_time_seconds=block_time,
                tokens=tokens,
            )
            self._networks.append(network)
            self._by_chain_id[chain_id] = network


# ---------------------------------------------------------------------------
# Module-level singleton — created once at import time using the default
# settings instance (which has already read from .env).
# ---------------------------------------------------------------------------
network_registry: NetworkRegistry = NetworkRegistry(_default_settings)
