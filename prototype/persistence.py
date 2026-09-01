"""SQLAlchemy persistence boundary for canonical project state."""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import DateTime, Integer, String, Text, create_engine, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.types import JSON


def database_url() -> str:
    # SQLite is intentionally limited to the local prototype/test experience.
    # Deployment must set DATABASE_URL to a PostgreSQL URL from .env.example.
    local_database = Path(__file__).resolve().parent / "storage" / "scorm-studio.db"
    return os.getenv("DATABASE_URL", f"sqlite+pysqlite:///{local_database.as_posix()}")


class Base(DeclarativeBase):
    pass


JsonDocument = JSON().with_variant(JSONB, "postgresql")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="active")
    course_json: Mapped[dict] = mapped_column(JsonDocument)
    schema_version: Mapped[str] = mapped_column(String(20))
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def make_session_factory(url: str | None = None):
    selected_url = url or database_url()
    connect_args = {"check_same_thread": False} if selected_url.startswith("sqlite") else {}
    engine = create_engine(selected_url, future=True, connect_args=connect_args)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def create_schema(engine) -> None:
    """Local bootstrap only. Production deployments apply Alembic migrations."""
    Base.metadata.create_all(engine)
