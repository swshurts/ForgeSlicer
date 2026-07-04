"""Symmetric encryption for user-provided secrets (BYO Meshy AI key, and
any similar per-user tokens we add later).

Design:
- Fernet symmetric encryption (AES-128-CBC + HMAC-SHA-256, IETF-safe).
- Key sourced from `FORGE_SECRET_ENC_KEY` env var. Must be a
  urlsafe-base64-encoded 32-byte key (Fernet format).
- If the env var is missing, we refuse to encrypt/decrypt — better to
  fail loudly than to persist secrets protected by a weak default.
  Admins can generate one with:
      python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

- Ciphertext stored in Mongo is a plain string (Fernet.encrypt returns
  urlsafe base64 bytes; we `.decode()` to str).
- `mask_secret` produces a display-friendly hint like "msy-abcd…7f2a"
  so the UI can confirm a key is saved without ever exposing it.
"""

from __future__ import annotations

import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

_ENC_ENV = "FORGE_SECRET_ENC_KEY"


class SecretsNotConfigured(RuntimeError):
    """Raised when the env encryption key is missing/invalid.
    Callers surface this as a 503 so the UI can show a clear
    "server misconfiguration" message rather than a 500."""


def _fernet() -> Fernet:
    raw = (os.environ.get(_ENC_ENV) or "").strip()
    if not raw:
        raise SecretsNotConfigured(
            f"{_ENC_ENV} is not set; per-user secrets cannot be stored. "
            f"Generate a key with `python -c 'from cryptography.fernet import "
            f"Fernet; print(Fernet.generate_key().decode())'` and add it to "
            f"backend/.env."
        )
    try:
        return Fernet(raw.encode() if isinstance(raw, str) else raw)
    except (ValueError, TypeError) as e:
        raise SecretsNotConfigured(f"{_ENC_ENV} is not a valid Fernet key: {e}")


def encrypt(plaintext: str) -> str:
    """Encrypt `plaintext` and return the ciphertext as a urlsafe-b64
    string suitable for storing in MongoDB."""
    if not plaintext:
        raise ValueError("encrypt(): empty plaintext")
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> Optional[str]:
    """Decrypt `ciphertext` produced by `encrypt`. Returns None on
    any failure (bad token, rotated key, corrupted row) so callers
    can gracefully fall back to the platform key instead of crashing
    the request."""
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError, SecretsNotConfigured):
        return None


def mask_secret(plaintext: str) -> str:
    """UI-safe hint. Preserves the first 4 and last 4 characters
    of the token, replaces the middle with ellipsis. For very short
    tokens returns "•••" so we never accidentally leak the whole
    thing."""
    if not plaintext:
        return ""
    s = str(plaintext)
    if len(s) <= 8:
        return "•" * len(s)
    return f"{s[:4]}…{s[-4:]}"
