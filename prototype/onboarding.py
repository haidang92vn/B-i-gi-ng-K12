"""Idempotent, secret-safe provisioning for the first school administrator."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from prototype.auth import normalise_email, password_hasher
from prototype.persistence import School, SchoolMembership, User, make_session_factory

EXPECTED_ALEMBIC_REVISION = "20260902_16"


class ProvisioningError(ValueError):
    pass


@dataclass(frozen=True)
class ProvisioningResult:
    school_id: str
    school_name: str
    admin_user_id: str
    admin_email: str
    created_user: bool
    created_school: bool


def clean_required(value: str | None, *, label: str, maximum: int) -> str:
    cleaned = " ".join((value or "").split())
    if not cleaned:
        raise ProvisioningError(f"{label} is required.")
    if len(cleaned) > maximum:
        raise ProvisioningError(f"{label} must be at most {maximum} characters.")
    return cleaned


def require_expected_migration(db: Session) -> None:
    try:
        version = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one_or_none()
    except Exception as exc:
        raise ProvisioningError("Alembic migration state is unavailable. Run the migration job before provisioning.") from exc
    if version != EXPECTED_ALEMBIC_REVISION:
        raise ProvisioningError(
            f"Database is at migration {version or 'none'}; expected {EXPECTED_ALEMBIC_REVISION}. Run the migration job first."
        )


def provision_school_admin(
    db: Session,
    *,
    school_name: str,
    admin_email: str,
    admin_password: str,
    admin_full_name: str | None = None,
) -> ProvisioningResult:
    """Create the first active user/school/admin membership without logging a password.

    Re-running is safe: an existing user retains its password and the membership is promoted to
    `school_admin`. Password reset remains a separate, explicit future operation.
    """
    name = clean_required(school_name, label="INITIAL_SCHOOL_NAME", maximum=200)
    email = normalise_email(clean_required(admin_email, label="INITIAL_ADMIN_EMAIL", maximum=320))
    if "@" not in email:
        raise ProvisioningError("INITIAL_ADMIN_EMAIL must be a valid email address.")
    if len(admin_password or "") < 12:
        raise ProvisioningError("INITIAL_ADMIN_PASSWORD must contain at least 12 characters.")
    full_name = " ".join((admin_full_name or "").split()) or None
    if full_name and len(full_name) > 200:
        raise ProvisioningError("INITIAL_ADMIN_FULL_NAME must be at most 200 characters.")

    user = db.scalar(select(User).where(User.email == email))
    created_user = user is None
    if user is None:
        user = User(
            email=email,
            password_hash=password_hasher.hash(admin_password),
            full_name=full_name,
            school_name=name,
            status="active",
        )
        db.add(user)
        db.flush()
    elif user.status != "active":
        raise ProvisioningError("Existing administrator account is inactive; reactivate it through the approved account process.")

    school = db.scalar(select(School).where(School.name == name))
    created_school = school is None
    if school is None:
        school = School(name=name, created_by_user_id=user.id)
        db.add(school)
        db.flush()

    membership = db.scalar(
        select(SchoolMembership).where(SchoolMembership.school_id == school.id, SchoolMembership.user_id == user.id)
    )
    if membership is None:
        db.add(SchoolMembership(school_id=school.id, user_id=user.id, role="school_admin"))
    else:
        membership.role = "school_admin"
    db.flush()
    return ProvisioningResult(
        school_id=school.id,
        school_name=school.name,
        admin_user_id=user.id,
        admin_email=user.email,
        created_user=created_user,
        created_school=created_school,
    )


def main() -> int:
    try:
        school_name = os.getenv("INITIAL_SCHOOL_NAME")
        admin_email = os.getenv("INITIAL_ADMIN_EMAIL")
        admin_password = os.getenv("INITIAL_ADMIN_PASSWORD")
        admin_full_name = os.getenv("INITIAL_ADMIN_FULL_NAME")
        engine, session_factory = make_session_factory()
        try:
            with session_factory() as db:
                require_expected_migration(db)
                result = provision_school_admin(
                    db,
                    school_name=school_name or "",
                    admin_email=admin_email or "",
                    admin_password=admin_password or "",
                    admin_full_name=admin_full_name,
                )
                db.commit()
        finally:
            engine.dispose()
    except ProvisioningError as exc:
        print(f"Provisioning refused: {exc}", file=sys.stderr)
        return 2
    except Exception:
        print("Provisioning failed; inspect protected server logs without printing environment values.", file=sys.stderr)
        return 1
    print(json.dumps({
        "status": "ok",
        "school_id": result.school_id,
        "school_name": result.school_name,
        "admin_user_id": result.admin_user_id,
        "admin_email": result.admin_email,
        "created_user": result.created_user,
        "created_school": result.created_school,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as a container command
    raise SystemExit(main())
