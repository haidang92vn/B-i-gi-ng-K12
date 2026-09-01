"""Create canonical project persistence table.

Revision ID: 20260901_01
Revises:
Create Date: 2026-09-01
"""
from alembic import op
import sqlalchemy as sa

revision = "20260901_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("course_json", sa.JSON(), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_owner_user_id", "projects", ["owner_user_id"])


def downgrade() -> None:
    op.drop_index("ix_projects_owner_user_id", table_name="projects")
    op.drop_table("projects")
