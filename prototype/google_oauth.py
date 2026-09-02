"""Google OpenID Connect server flow with PKCE and verified ID-token handling."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token

GOOGLE_ATTEMPT_COOKIE = "google_oauth_attempt"
GOOGLE_ATTEMPT_MAX_AGE = 10 * 60
GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


class GoogleOAuthError(ValueError):
    pass


@dataclass(frozen=True)
class GoogleOAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: str


@dataclass(frozen=True)
class GoogleAttempt:
    state: str
    nonce: str
    code_verifier: str


@dataclass(frozen=True)
class GoogleProfile:
    subject: str
    email: str
    full_name: str | None


def config_from_env() -> GoogleOAuthConfig:
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "").strip()
    if not client_id or not client_secret or not redirect_uri:
        raise GoogleOAuthError("Google sign-in is not configured.")
    if not redirect_uri.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
        raise GoogleOAuthError("Google redirect URI must use HTTPS outside local development.")
    return GoogleOAuthConfig(client_id=client_id, client_secret=client_secret, redirect_uri=redirect_uri)


def new_attempt() -> GoogleAttempt:
    return GoogleAttempt(state=secrets.token_urlsafe(32), nonce=secrets.token_urlsafe(32), code_verifier=secrets.token_urlsafe(72))


def encode_attempt(attempt: GoogleAttempt) -> str:
    raw = json.dumps(attempt.__dict__, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_attempt(value: str | None) -> GoogleAttempt:
    if not value:
        raise GoogleOAuthError("Google sign-in state is missing or expired.")
    try:
        padded = value + "=" * (-len(value) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        attempt = GoogleAttempt(**payload)
    except Exception as exc:
        raise GoogleOAuthError("Google sign-in state is invalid.") from exc
    if min(len(attempt.state), len(attempt.nonce), len(attempt.code_verifier)) < 24:
        raise GoogleOAuthError("Google sign-in state is invalid.")
    return attempt


def authorization_url(config: GoogleOAuthConfig, attempt: GoogleAttempt) -> str:
    challenge = base64.urlsafe_b64encode(hashlib.sha256(attempt.code_verifier.encode("ascii")).digest()).decode("ascii").rstrip("=")
    params = {
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": attempt.state,
        "nonce": attempt.nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTHORIZATION_URL}?{urlencode(params)}"


def exchange_code(config: GoogleOAuthConfig, attempt: GoogleAttempt, code: str) -> GoogleProfile:
    try:
        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "redirect_uri": config.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": attempt.code_verifier,
            },
            timeout=10,
        )
        response.raise_for_status()
        token = response.json().get("id_token")
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleOAuthError("Google could not complete sign-in. Please try again.") from exc
    if not isinstance(token, str):
        raise GoogleOAuthError("Google did not return a valid identity token.")
    try:
        claims = id_token.verify_oauth2_token(token, GoogleRequest(), config.client_id)
    except Exception as exc:
        raise GoogleOAuthError("Google identity token verification failed.") from exc
    if claims.get("iss") not in {"https://accounts.google.com", "accounts.google.com"}:
        raise GoogleOAuthError("Google identity token issuer is invalid.")
    if not hmac.compare_digest(str(claims.get("nonce", "")), attempt.nonce):
        raise GoogleOAuthError("Google sign-in nonce is invalid.")
    if claims.get("email_verified") is not True:
        raise GoogleOAuthError("A verified Google email address is required.")
    subject, email = str(claims.get("sub", "")), str(claims.get("email", "")).strip().lower()
    if not subject or "@" not in email:
        raise GoogleOAuthError("Google identity is incomplete.")
    full_name = str(claims.get("name", "")).strip() or None
    return GoogleProfile(subject=subject, email=email, full_name=full_name)
