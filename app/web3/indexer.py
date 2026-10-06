"""
Multi-network EVM Blockchain Event Indexer & RPC Scanner.

Scans configured EVM networks (Base, Ethereum, Polygon, Arbitrum, BSC, Optimism)
for ERC-20 Transfer logs and native currency transactions matching active
merchant receiving wallet addresses.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import uuid
from decimal import Decimal
from typing import Any, Optional

import httpx
from fastapi import HTTPException
from starlette.datastructures import Headers
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.models import MerchantProfile, MerchantWallet, Payment, PaymentLink
from app.core.networks import NetworkConfig, TokenConfig, network_registry
from app.web3.state_machine import PaymentStateMachine, raw_to_decimal

logger = logging.getLogger(__name__)

# Standard ERC-20 Transfer(address,address,uint256) event topic
ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def pad_address_to_topic(address: str) -> str:
    """Pad a 20-byte EVM address (0x...) to a 32-byte log topic format."""
    clean = address.lower().replace("0x", "")
    return f"0x{'0' * (64 - len(clean))}{clean}"


def unpad_topic_to_address(topic: str) -> str:
    """Convert a 32-byte log topic to a checksummed/lowercased 20-byte EVM address."""
    clean = topic.replace("0x", "")
    if len(clean) >= 40:
        return f"0x{clean[-40:].lower()}"
    return f"0x{clean.lower()}"


class EVMRpcClient:
    """Lightweight async JSON-RPC client with error handling and timeouts."""

    def __init__(self, rpc_url: str, timeout_seconds: float = 10.0) -> None:
        self.rpc_url = rpc_url
        self.timeout = timeout_seconds

    async def _rpc_call(self, method: str, params: list[Any]) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(self.rpc_url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                raise RuntimeError(f"RPC error from {self.rpc_url}: {data['error']}")
            return data.get("result")

    async def get_block_number(self) -> int:
        """Return the current block number as an integer."""
        res = await self._rpc_call("eth_blockNumber", [])
        return int(res, 16)

    async def get_logs(
        self,
        from_block: int,
        to_block: int,
        address: Optional[str] = None,
        topics: Optional[list[Any]] = None,
    ) -> list[dict[str, Any]]:
        """Query log events matching criteria within a block range."""
        filter_params: dict[str, Any] = {
            "fromBlock": hex(from_block),
            "toBlock": hex(to_block),
        }
        if address:
            filter_params["address"] = address
        if topics:
            filter_params["topics"] = topics

        res = await self._rpc_call("eth_getLogs", [filter_params])
        return res or []

    async def get_block_by_number(self, block_num: int, full_transactions: bool = True) -> dict[str, Any]:
        """Fetch block data and transactions by block number."""
        res = await self._rpc_call("eth_getBlockByNumber", [hex(block_num), full_transactions])
        return res or {}

    async def get_transaction_receipt(self, tx_hash: str) -> Optional[dict[str, Any]]:
        """Fetch transaction receipt for confirmation and status verification."""
        return await self._rpc_call("eth_getTransactionReceipt", [tx_hash])


class EVMIndexer:
    """Scans EVM chains for merchant transfers and advances payment states."""

    @staticmethod
    async def get_active_merchant_wallets(network_name: str, db: AsyncSession) -> list[MerchantWallet]:
        """Fetch all active/pending merchant receiving wallets for a given network."""
        result = await db.execute(
            select(MerchantWallet).where(
                and_(
                    MerchantWallet.network.ilike(network_name),
                    MerchantWallet.status.in_(["active", "pending"]),
                )
            )
        )
        return list(result.scalars().all())

    @staticmethod
    async def match_payment_link_for_wallet(
        merchant_id: uuid.UUID,
        amount: Decimal,
        token_symbol: str,
        network_name: str,
        db: AsyncSession,
    ) -> Optional[PaymentLink]:
        """Find the matching active PaymentLink for a detected incoming transfer."""
        result = await db.execute(
            select(PaymentLink).where(
                and_(
                    PaymentLink.merchant_id == merchant_id,
                    PaymentLink.status == "active",
                )
            )
        )
        links = result.scalars().all()
        for link in links:
            # Check accepted tokens snapshot
            accepted = link.accepted_tokens or []
            matches_token = False
            for t in accepted:
                if (
                    isinstance(t, dict)
                    and t.get("network", "").lower() == network_name.lower()
                    and t.get("token_symbol", "").upper() == token_symbol.upper()
                ):
                    matches_token = True
                    break

            if matches_token:
                if link.amount_mode == "flexible":
                    return link
                if link.amount and abs(Decimal(str(link.amount)) - amount) < Decimal("0.0001"):
                    return link

        # Only return a link if token configuration and amount strictly match
        return None

    @staticmethod
    async def scan_network(
        network: NetworkConfig,
        from_block: int,
        to_block: int,
        db: AsyncSession,
    ) -> list[Payment]:
        """Scan a block range on a specific network for merchant incoming transfers."""
        detected_payments: list[Payment] = []
        client = EVMRpcClient(network.rpc_url)
        wallets = await EVMIndexer.get_active_merchant_wallets(network.display_name, db)
        if not wallets:
            return []

        wallet_address_map = {w.address.lower(): w for w in wallets}
        padded_topics = [pad_address_to_topic(w.address) for w in wallets]

        # 1. Scan ERC-20 Transfer logs
        try:
            logs = await client.get_logs(
                from_block=from_block,
                to_block=to_block,
                topics=[ERC20_TRANSFER_TOPIC, None, padded_topics],
            )
            for log in logs:
                contract_address = log.get("address", "").lower()
                topics = log.get("topics", [])
                if len(topics) < 3:
                    continue

                from_addr = unpad_topic_to_address(topics[1])
                to_addr = unpad_topic_to_address(topics[2])
                raw_data = log.get("data", "0x0")
                raw_value = int(raw_data, 16) if raw_data != "0x" else 0
                tx_hash = log.get("transactionHash", "")
                block_number = int(log.get("blockNumber", "0x0"), 16)

                wallet = wallet_address_map.get(to_addr)
                if not wallet:
                    continue

                # Identify token symbol from network configuration
                token_symbol = "USDC"
                for t in network.tokens:
                    if t.contract_address and t.contract_address.lower() == contract_address:
                        token_symbol = t.symbol
                        break

                decimal_amount = raw_to_decimal(raw_value, token_symbol)

                # Match payment link
                payment_link = await EVMIndexer.match_payment_link_for_wallet(
                    merchant_id=wallet.merchant_id,
                    amount=decimal_amount,
                    token_symbol=token_symbol,
                    network_name=network.display_name,
                    db=db,
                )

                if payment_link:
                    payment = await PaymentStateMachine.record_detected_payment(
                        payment_link_id=payment_link.id,
                        invoice_id=None,
                        network=network.display_name,
                        token_symbol=token_symbol,
                        contract_address=contract_address,
                        from_address=from_addr,
                        to_address=to_addr,
                        amount=decimal_amount,
                        tx_hash=tx_hash,
                        block_number=block_number,
                        db=db,
                    )
                    detected_payments.append(payment)
        except Exception as exc:
            logger.warning("Error querying ERC-20 logs on %s: %s", network.display_name, exc)

        return detected_payments


# ---------------------------------------------------------------------------
# Webhook mode — shared constants
# ---------------------------------------------------------------------------

# Testnet chain IDs that should only be processed when testnet_mode = True
TESTNET_CHAIN_IDS: frozenset[int] = frozenset({11155111, 84532, 80001, 421614, 11155420})

# Mainnet chain IDs that should only be processed when testnet_mode = False
MAINNET_CHAIN_IDS: frozenset[int] = frozenset({1, 8453, 137, 42161, 10, 56})


# ---------------------------------------------------------------------------
# Task 2.1 — HMAC signature validation
# ---------------------------------------------------------------------------

def _validate_provider_signature(body: bytes, headers: "Headers") -> None:
    """Validate the HMAC-SHA256 signature from Alchemy or QuickNode.

    Raises HTTPException(401) if neither header is present or the digest
    does not match.

    Requirements: 1.2, 1.3
    """
    secret = settings.blockchain_webhook_secret.encode()
    alchemy_sig = headers.get("X-Alchemy-Signature", "")
    qn_sig = headers.get("X-QN-Signature", "")
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    if not (
        (alchemy_sig and hmac.compare_digest(expected, alchemy_sig))
        or (qn_sig and hmac.compare_digest(expected, qn_sig))
    ):
        raise HTTPException(status_code=401, detail="invalid_signature")


# ---------------------------------------------------------------------------
# Task 2.2 — Payload parsers
# ---------------------------------------------------------------------------

def parse_alchemy_payload(payload: dict) -> list[dict]:
    """Parse an Alchemy webhook payload into a normalised list of transfer dicts.

    Iterates ``payload["event"]["activity"]`` and returns entries whose
    ``category`` is ``"erc20"``.  Returns an empty list if the structure is
    unrecognised.

    Each returned dict has keys:
        tx_hash, from_address, to_address, contract_address,
        raw_value, block_number, chain_id

    Requirements: 1.4
    """
    try:
        activity: list[dict] = payload["event"]["activity"]
    except (KeyError, TypeError):
        logger.debug("parse_alchemy_payload: unrecognised payload structure")
        return []

    results: list[dict] = []
    for item in activity:
        try:
            if item.get("category") != "erc20":
                continue

            # chain_id may be present as an int or hex string
            raw_chain = item.get("chainId") or payload.get("event", {}).get("network", "")
            chain_id = _parse_chain_id(raw_chain)

            raw_value_hex: str = item.get("rawContract", {}).get("rawValue", "0x0") or "0x0"
            raw_value = int(raw_value_hex, 16) if raw_value_hex.startswith("0x") else int(raw_value_hex)

            results.append({
                "tx_hash": item.get("hash", "").lower(),
                "from_address": item.get("fromAddress", "").lower(),
                "to_address": item.get("toAddress", "").lower(),
                "contract_address": (item.get("rawContract", {}).get("address") or "").lower(),
                "raw_value": raw_value,
                "block_number": _parse_block_number(item.get("blockNum")),
                "chain_id": chain_id,
            })
        except Exception as exc:  # noqa: BLE001
            logger.warning("parse_alchemy_payload: skipping malformed activity item: %s", exc)
            continue

    return results


def parse_quicknode_payload(payload: dict) -> list[dict]:
    """Parse a QuickNode webhook payload into a normalised list of transfer dicts.

    Iterates ``payload["matchedTransactions"]`` and returns entries that
    contain an ERC-20 Transfer log topic.  Returns an empty list if the
    structure is unrecognised.

    Each returned dict has the same keys as :func:`parse_alchemy_payload`.

    Requirements: 1.4
    """
    try:
        transactions: list[dict] = payload["matchedTransactions"]
    except (KeyError, TypeError):
        logger.debug("parse_quicknode_payload: unrecognised payload structure")
        return []

    results: list[dict] = []
    for tx in transactions:
        try:
            chain_id = _parse_chain_id(tx.get("chainId") or payload.get("chainId"))
            tx_hash = (tx.get("transactionHash") or "").lower()
            from_address = (tx.get("from") or "").lower()
            block_number = _parse_block_number(tx.get("blockNumber"))

            for log in tx.get("logs", []):
                topics: list[str] = log.get("topics", [])
                if not topics or topics[0].lower() != ERC20_TRANSFER_TOPIC:
                    continue
                if len(topics) < 3:
                    continue

                to_address = unpad_topic_to_address(topics[2])
                contract_address = (log.get("address") or "").lower()
                raw_data: str = log.get("data", "0x0") or "0x0"
                raw_value = int(raw_data, 16) if raw_data not in ("0x", "") else 0

                results.append({
                    "tx_hash": tx_hash,
                    "from_address": from_address,
                    "to_address": to_address,
                    "contract_address": contract_address,
                    "raw_value": raw_value,
                    "block_number": block_number,
                    "chain_id": chain_id,
                })
        except Exception as exc:  # noqa: BLE001
            logger.warning("parse_quicknode_payload: skipping malformed transaction: %s", exc)
            continue

    return results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_chain_id(value: Any) -> int:
    """Convert a chain ID value that may be int or hex string to int."""
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value, 16) if value.startswith("0x") else int(value)
        except ValueError:
            return 0
    return 0


def _parse_block_number(value: Any) -> Optional[int]:
    """Convert a block number value that may be int or hex string to int."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value, 16) if value.startswith("0x") else int(value)
        except ValueError:
            return None
    return None


def _run_async(coro):
    """Run an async coroutine safely from a synchronous Celery task."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)


async def _get_session():
    """Return a fresh async DB session."""
    from app.core.db import AsyncSessionLocal
    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Task 2.3 — process_blockchain_event Celery task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="app.web3.indexer.process_blockchain_event",
    max_retries=3,
)
def process_blockchain_event(self, payload: dict) -> None:
    """Process a webhook payload from Alchemy or QuickNode.

    1. Parses the payload with both parsers (whichever returns results wins).
    2. Filters events by chain ID according to testnet_mode.
    3. For each matching wallet, calls PaymentStateMachine.record_detected_payment.

    Retries on failure with delays of [5, 30, 300] seconds.

    Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 9.3, 9.4
    """
    try:
        _run_async(_process_blockchain_event_async(payload))
    except Exception as exc:
        delays = [5, 30, 300]
        retry_index = min(self.request.retries, len(delays) - 1)
        logger.warning(
            "process_blockchain_event failed (attempt %d/%d): %s",
            self.request.retries + 1,
            self.max_retries + 1,
            exc,
        )
        raise self.retry(exc=exc, countdown=delays[retry_index])


async def _process_blockchain_event_async(payload: dict) -> None:
    """Async implementation of process_blockchain_event."""
    # Try Alchemy parser first, then QuickNode
    transfers = parse_alchemy_payload(payload)
    if not transfers:
        transfers = parse_quicknode_payload(payload)

    if not transfers:
        logger.debug("process_blockchain_event: no recognised transfers in payload")
        return

    async with await _get_session() as db:
        for transfer in transfers:
            chain_id: int = transfer.get("chain_id", 0)

            # Req 9.3: testnet_mode=True → only process testnet chains
            # Req 9.4: testnet_mode=False → only process mainnet chains, warn and skip testnet
            if settings.testnet_mode:
                if chain_id not in TESTNET_CHAIN_IDS:
                    logger.debug(
                        "process_blockchain_event: skipping mainnet chain_id=%d (testnet_mode=True)",
                        chain_id,
                    )
                    continue
            else:
                if chain_id in TESTNET_CHAIN_IDS:
                    logger.warning(
                        "process_blockchain_event: skipping testnet chain_id=%d (testnet_mode=False)",
                        chain_id,
                    )
                    continue

            to_address: str = transfer.get("to_address", "").lower()
            if not to_address:
                continue

            # Look up MerchantWallet by receiving address
            result = await db.execute(
                select(MerchantWallet).where(
                    and_(
                        MerchantWallet.address == to_address,
                        MerchantWallet.status.in_(["active", "pending"]),
                    )
                )
            )
            wallet: Optional[MerchantWallet] = result.scalar_one_or_none()
            if wallet is None:
                continue

            # Resolve token symbol from contract address via network registry
            contract_address: str = transfer.get("contract_address", "").lower()
            token_symbol = _resolve_token_symbol(contract_address, wallet.network)
            if not token_symbol:
                logger.debug(
                    "process_blockchain_event: unknown contract %s on %s — skipping",
                    contract_address,
                    wallet.network,
                )
                continue

            # Find an active PaymentLink for this merchant
            pl_result = await db.execute(
                select(PaymentLink).where(
                    and_(
                        PaymentLink.merchant_id == wallet.merchant_id,
                        PaymentLink.status == "active",
                    )
                )
            )
            payment_link: Optional[PaymentLink] = pl_result.scalars().first()
            if payment_link is None:
                logger.debug(
                    "process_blockchain_event: no active PaymentLink for merchant %s — skipping",
                    wallet.merchant_id,
                )
                continue

            # Determine token decimals and convert raw_value to Decimal
            raw_value: int = transfer.get("raw_value", 0)
            amount = raw_to_decimal(raw_value, token_symbol)

            try:
                await PaymentStateMachine.record_detected_payment(
                    payment_link_id=payment_link.id,
                    invoice_id=None,
                    network=wallet.network,
                    token_symbol=token_symbol,
                    contract_address=contract_address or None,
                    from_address=transfer.get("from_address", ""),
                    to_address=to_address,
                    amount=amount,
                    tx_hash=transfer.get("tx_hash", ""),
                    block_number=transfer.get("block_number"),
                    db=db,
                )
            except Exception as exc:
                logger.error(
                    "process_blockchain_event: record_detected_payment failed for tx=%s: %s",
                    transfer.get("tx_hash"),
                    exc,
                )
                raise

        await db.commit()


def _resolve_token_symbol(contract_address: str, network_name: str) -> Optional[str]:
    """Look up a token symbol by contract address on a given network.

    First tries networks whose display_name matches network_name (case-insensitive).
    Falls back to searching all active networks if no match found on the named network.
    Returns None if the contract is not recognised.
    """
    # Try the specific network first
    for net in network_registry.get_active_networks():
        if net.display_name.lower() == network_name.lower():
            for token in net.tokens:
                if token.contract_address and token.contract_address.lower() == contract_address:
                    return token.symbol
            break  # found the named network but contract wasn't there — still fall through

    # Fallback: search all active networks
    for net in network_registry.get_active_networks():
        for token in net.tokens:
            if token.contract_address and token.contract_address.lower() == contract_address:
                return token.symbol

    return None


# ---------------------------------------------------------------------------
# Testnet RPC overrides — used by the polling task when testnet_mode = True
# Maps mainnet chain_id → testnet RPC URL setting
# ---------------------------------------------------------------------------

TESTNET_RPC_MAP: dict[int, str] = {
    1: settings.ethereum_sepolia_rpc_url,
    8453: settings.base_sepolia_rpc_url,
    137: settings.polygon_mumbai_rpc_url,
    42161: settings.arbitrum_sepolia_rpc_url,
    10: settings.optimism_sepolia_rpc_url,
}


# ---------------------------------------------------------------------------
# Task 3.1 — Polling fallback indexer
# ---------------------------------------------------------------------------


@celery_app.task(name="app.web3.indexer.poll_blockchain_events")
def poll_blockchain_events() -> None:
    """Scan all active EVM networks for new ERC-20 Transfer events on a cadence.

    Runs every 15 seconds via Celery beat (see beat_schedule in celery_app.py).
    Only executes the scan body when ``settings.indexer_polling_enabled`` is
    ``True``; otherwise exits immediately so beat overhead is negligible.

    For each active network the task:
    1. Resolves the correct RPC URL (testnet override when testnet_mode=True).
    2. Reads the last processed block from Redis.
    3. Fetches the current head block via eth_blockNumber.
    4. Queries eth_getLogs for ERC-20 Transfer events targeting merchant wallets.
    5. For each match, records the payment via PaymentStateMachine.
    6. Persists the latest processed block back to Redis.

    Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
    """
    if not settings.indexer_polling_enabled:
        logger.debug("poll_blockchain_events: indexer_polling_enabled=False, skipping")
        return

    import redis as sync_redis  # sync client — Celery tasks are synchronous

    r = sync_redis.from_url(settings.redis_url)

    for network in network_registry.get_active_networks():
        chain_id = network.chain_id

        # ----------------------------------------------------------------
        # 1. Resolve RPC URL (testnet override if testnet_mode is active)
        # ----------------------------------------------------------------
        if settings.testnet_mode:
            testnet_rpc = TESTNET_RPC_MAP.get(chain_id, "")
            if not testnet_rpc or not testnet_rpc.strip():
                logger.debug(
                    "poll_blockchain_events: no testnet RPC for chain_id=%d (%s), skipping",
                    chain_id,
                    network.display_name,
                )
                continue
            rpc_url = testnet_rpc
        else:
            rpc_url = network.rpc_url

        client = EVMRpcClient(rpc_url)
        redis_key = f"indexer:last_block:{chain_id}"

        # ----------------------------------------------------------------
        # 2–4. Fetch block numbers and query logs
        # ----------------------------------------------------------------
        try:
            current_block: int = _run_async(client.get_block_number())
        except Exception as exc:
            logger.warning(
                "poll_blockchain_events: RPC error fetching block number for chain_id=%d (%s): %s",
                chain_id,
                network.display_name,
                exc,
            )
            continue

        # Read last processed block; default to (current - 10) on first run
        last_block: int = int(r.get(redis_key) or current_block - 10)
        from_block: int = max(last_block + 1, current_block - 10)

        # Collect padded merchant-wallet topics asynchronously
        try:
            wallets, wallet_address_map = _run_async(
                _load_merchant_wallets_for_network(network.display_name)
            )
        except Exception as exc:
            logger.warning(
                "poll_blockchain_events: DB error loading wallets for chain_id=%d (%s): %s",
                chain_id,
                network.display_name,
                exc,
            )
            continue

        if not wallets:
            # No active wallets on this network — still advance the cursor
            r.set(redis_key, str(current_block))
            continue

        padded_topics = [pad_address_to_topic(w.address) for w in wallets]

        try:
            logs: list[dict] = _run_async(
                client.get_logs(
                    from_block=from_block,
                    to_block=current_block,
                    topics=[ERC20_TRANSFER_TOPIC, None, padded_topics],
                )
            )
        except Exception as exc:
            logger.warning(
                "poll_blockchain_events: RPC error fetching logs for chain_id=%d (%s): %s",
                chain_id,
                network.display_name,
                exc,
            )
            continue

        # ----------------------------------------------------------------
        # 5. Process each matched Transfer log
        # ----------------------------------------------------------------
        for log in logs:
            try:
                topics = log.get("topics", [])
                if len(topics) < 3:
                    continue

                to_addr = unpad_topic_to_address(topics[2])
                wallet = wallet_address_map.get(to_addr)
                if not wallet:
                    continue

                contract_address = log.get("address", "").lower()
                token_symbol = _resolve_token_symbol(contract_address, network.display_name)
                if not token_symbol:
                    logger.debug(
                        "poll_blockchain_events: unknown contract %s on %s — skipping",
                        contract_address,
                        network.display_name,
                    )
                    continue

                raw_data: str = log.get("data", "0x0") or "0x0"
                raw_value: int = int(raw_data, 16) if raw_data not in ("0x", "") else 0
                amount = raw_to_decimal(raw_value, token_symbol)
                tx_hash: str = log.get("transactionHash", "").lower()
                block_number: Optional[int] = _parse_block_number(log.get("blockNumber"))
                from_addr = unpad_topic_to_address(topics[1])

                # Find the merchant's active PaymentLink
                payment_link = _run_async(
                    _find_active_payment_link(wallet.merchant_id)
                )
                if payment_link is None:
                    logger.debug(
                        "poll_blockchain_events: no active PaymentLink for merchant %s — skipping",
                        wallet.merchant_id,
                    )
                    continue

                # Record the detected payment
                _run_async(
                    _record_payment_for_poll(
                        payment_link_id=payment_link.id,
                        network=network.display_name,
                        token_symbol=token_symbol,
                        contract_address=contract_address,
                        from_address=from_addr,
                        to_address=to_addr,
                        amount=amount,
                        tx_hash=tx_hash,
                        block_number=block_number,
                    )
                )

            except Exception as exc:
                exc_msg = str(exc)
                if "UNIQUE" in exc_msg or "unique constraint" in exc_msg.lower():
                    logger.debug(
                        "poll_blockchain_events: duplicate tx_hash detected for log on chain_id=%d, skipping",
                        chain_id,
                    )
                else:
                    logger.error(
                        "poll_blockchain_events: error processing log on chain_id=%d (%s): %s",
                        chain_id,
                        network.display_name,
                        exc,
                    )
                continue

        # ----------------------------------------------------------------
        # 6. Persist the latest processed block cursor back to Redis
        # ----------------------------------------------------------------
        r.set(redis_key, str(current_block))
        logger.debug(
            "poll_blockchain_events: chain_id=%d (%s) scanned blocks %d–%d, cursor updated to %d",
            chain_id,
            network.display_name,
            from_block,
            current_block,
            current_block,
        )


# ---------------------------------------------------------------------------
# Async helpers for the polling task
# ---------------------------------------------------------------------------


async def _load_merchant_wallets_for_network(
    network_display_name: str,
) -> tuple[list[MerchantWallet], dict[str, MerchantWallet]]:
    """Return (wallets, address_map) for active/pending wallets on the given network."""
    async with await _get_session() as db:
        result = await db.execute(
            select(MerchantWallet).where(
                and_(
                    MerchantWallet.network.ilike(network_display_name),
                    MerchantWallet.status.in_(["active", "pending"]),
                )
            )
        )
        wallets = list(result.scalars().all())
        address_map = {w.address.lower(): w for w in wallets}
        return wallets, address_map


async def _find_active_payment_link(merchant_id) -> Optional[PaymentLink]:
    """Return the first active PaymentLink for the given merchant, or None."""
    async with await _get_session() as db:
        result = await db.execute(
            select(PaymentLink).where(
                and_(
                    PaymentLink.merchant_id == merchant_id,
                    PaymentLink.status == "active",
                )
            )
        )
        return result.scalars().first()


async def _record_payment_for_poll(
    *,
    payment_link_id,
    network: str,
    token_symbol: str,
    contract_address: Optional[str],
    from_address: str,
    to_address: str,
    amount,
    tx_hash: str,
    block_number: Optional[int],
) -> None:
    """Open a DB session and call PaymentStateMachine.record_detected_payment."""
    async with await _get_session() as db:
        await PaymentStateMachine.record_detected_payment(
            payment_link_id=payment_link_id,
            invoice_id=None,
            network=network,
            token_symbol=token_symbol,
            contract_address=contract_address,
            from_address=from_address,
            to_address=to_address,
            amount=amount,
            tx_hash=tx_hash,
            block_number=block_number,
            db=db,
        )
        await db.commit()
