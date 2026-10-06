"""
Generate a fresh RSA-2048 key pair and print both PEM-encoded keys to stdout.

Usage::

    python scripts/generate_keypair.py

Output::

    ---- PRIVATE KEY (set as JWT_PRIVATE_KEY) ----
    -----BEGIN RSA PRIVATE KEY-----
    ...
    -----END RSA PRIVATE KEY-----

    ---- PUBLIC KEY (set as JWT_PUBLIC_KEY) ----
    -----BEGIN PUBLIC KEY-----
    ...
    -----END PUBLIC KEY-----

Copy each block into your .env file, replacing literal newlines with \\n if
your environment requires single-line values.
"""
from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def generate_rsa_keypair() -> tuple[str, str]:
    """Generate an RSA-2048 key pair and return (private_pem, public_pem)."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    return private_pem, public_pem


def main() -> None:
    private_pem, public_pem = generate_rsa_keypair()

    print("---- PRIVATE KEY (set as JWT_PRIVATE_KEY) ----")
    print(private_pem)
    print("---- PUBLIC KEY (set as JWT_PUBLIC_KEY) ----")
    print(public_pem)

    # Also emit single-line versions suitable for .env files
    private_oneline = private_pem.replace("\n", "\\n")
    public_oneline = public_pem.replace("\n", "\\n")

    print("---- .env single-line format ----")
    print(f"JWT_PRIVATE_KEY={private_oneline}")
    print(f"JWT_PUBLIC_KEY={public_oneline}")


if __name__ == "__main__":
    main()
