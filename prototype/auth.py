"""Opaque, revocable browser sessions for the prototype API."""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from prototype.persistence import AuthSession, User

COOKIE_NAME = "scorm_session"
SESSION_DAYS = int(os.getenv("JWT_REFRESH_DAYS", "30"))
password_hasher = PasswordHash.recommended()


def normalise_email(email: str) -> str:
    return email.strip().lower()


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session(db: Session, user: User) -> str:
    raw_token = secrets.token_urlsafe(32)
    db.add(AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
    ))
    return raw_token


def current_session(db: Session, token: str | None) -> tuple[User, AuthSession] | None:
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_session_token(token)))
    if session is None or session.revoked_at is not None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    user = db.get(User, session.user_id)
    if user is None or user.status != "active":
        return None
    return user, session


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token, httponly=True, secure=os.getenv("APP_ENV") == "production",
        samesite="lax", max_age=SESSION_DAYS * 24 * 60 * 60, path="/",
    )
