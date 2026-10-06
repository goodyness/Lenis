"""
Unit tests for EIP-191 Cryptographic Wallet Verification.
"""
import uuid
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from app.web3.verifier import generate_wallet_challenge, verify_wallet_signature


@pytest.mark.asyncio
async def test_generate_and_verify_valid_signature():
    merchant_id = uuid.uuid4()
    wallet = Account.create()
    address = wallet.address

    # 1. Generate challenge
    challenge_data = await generate_wallet_challenge(merchant_id=merchant_id, address=address)
    assert "challenge" in challenge_data
    assert "nonce" in challenge_data
    assert challenge_data["address"] == address

    # 2. Sign message using private key
    encoded = encode_defunct(text=challenge_data["challenge"])
    signed = Account.sign_message(encoded, private_key=wallet.key)
    sig_hex = signed.signature.hex()
    if not sig_hex.startswith("0x"):
        sig_hex = f"0x{sig_hex}"

    # 3. Verify signature
    is_valid = await verify_wallet_signature(
        address=address,
        signature=sig_hex,
        nonce=challenge_data["nonce"],
    )
    assert is_valid is True


@pytest.mark.asyncio
async def test_signature_replay_prevention():
    merchant_id = uuid.uuid4()
    wallet = Account.create()
    address = wallet.address

    challenge_data = await generate_wallet_challenge(merchant_id=merchant_id, address=address)
    encoded = encode_defunct(text=challenge_data["challenge"])
    signed = Account.sign_message(encoded, private_key=wallet.key)
    raw_hex = signed.signature.hex()
    sig_hex = raw_hex if raw_hex.startswith("0x") else f"0x{raw_hex}"

    # First verification succeeds and consumes nonce
    first_res = await verify_wallet_signature(
        address=address,
        signature=sig_hex,
        nonce=challenge_data["nonce"],
    )
    assert first_res is True

    # Second attempt with same nonce must fail (replay protection)
    second_res = await verify_wallet_signature(
        address=address,
        signature=sig_hex,
        nonce=challenge_data["nonce"],
    )
    assert second_res is False


@pytest.mark.asyncio
async def test_signature_address_mismatch():
    merchant_id = uuid.uuid4()
    wallet_a = Account.create()
    wallet_b = Account.create()

    # Generate challenge for wallet A
    challenge_data = await generate_wallet_challenge(merchant_id=merchant_id, address=wallet_a.address)

    # Sign with wallet B (wrong key)
    encoded = encode_defunct(text=challenge_data["challenge"])
    signed_b = Account.sign_message(encoded, private_key=wallet_b.key)
    raw_hex = signed_b.signature.hex()
    sig_hex = raw_hex if raw_hex.startswith("0x") else f"0x{raw_hex}"

    # Verify against wallet A must fail
    res = await verify_wallet_signature(
        address=wallet_a.address,
        signature=sig_hex,
        nonce=challenge_data["nonce"],
    )
    assert res is False


@pytest.mark.asyncio
async def test_signature_crlf_normalization():
    merchant_id = uuid.uuid4()
    wallet = Account.create()
    address = wallet.address

    challenge_data = await generate_wallet_challenge(merchant_id=merchant_id, address=address)
    # Simulate client / OS normalizing or converting newlines to \r\n or \n
    client_normalized_text = challenge_data["challenge"].replace("\r\n", "\n")
    encoded = encode_defunct(text=client_normalized_text)
    signed = Account.sign_message(encoded, private_key=wallet.key)
    sig_hex = signed.signature.hex()
    if not sig_hex.startswith("0x"):
        sig_hex = f"0x{sig_hex}"

    # Verify signature
    is_valid = await verify_wallet_signature(
        address=address,
        signature=sig_hex,
        nonce=challenge_data["nonce"],
    )
    assert is_valid is True

