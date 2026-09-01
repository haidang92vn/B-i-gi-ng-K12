from __future__ import annotations
import base64, hashlib, os
from cryptography.fernet import Fernet

def cipher() -> Fernet:
    key = os.getenv("CREDENTIAL_ENCRYPTION_KEY")
    if not key:
        if os.getenv("APP_ENV", "development").lower() in {"production", "prod"}:
            raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY is required in production.")
        # Local-only fallback; it must never be used to deploy the application.
        key = base64.urlsafe_b64encode(hashlib.sha256(b"local-demo-not-for-production").digest()).decode()
    return Fernet(key.encode())

def encrypt(secret: str) -> str: return cipher().encrypt(secret.encode()).decode()
def decrypt(token: str) -> str: return cipher().decrypt(token.encode()).decode()
