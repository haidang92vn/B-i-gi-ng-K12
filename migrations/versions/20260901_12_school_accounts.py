"""Add schools, memberships and per-project sharing.

Revision ID: 20260901_12
Revises: 20260901_10
"""
from alembic import op
import sqlalchemy as sa

revision = "20260901_12"
down_revision = "20260901_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schools",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_schools_name", "schools", ["name"])
    op.create_index("ix_schools_created_by_user_id", "schools", ["created_by_user_id"])
    op.create_table(
        "school_memberships",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("school_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="teacher"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("school_id", "user_id", name="uq_school_memberships_school_user"),
    )
    op.create_index("ix_school_memberships_school_id", "school_memberships", ["school_id"])
    op.create_index("ix_school_memberships_user_id", "school_memberships", ["user_id"])
    op.create_table(
        "project_shares",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("access_level", sa.String(length=20), nullable=False, server_default="viewer"),
        sa.Column("granted_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["granted_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_shares_project_user"),
    )
    op.create_index("ix_project_shares_project_id", "project_shares", ["project_id"])
    op.create_index("ix_project_shares_user_id", "project_shares", ["user_id"])
    op.create_index("ix_project_shares_granted_by_user_id", "project_shares", ["granted_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_project_shares_granted_by_user_id", table_name="project_shares")
    op.drop_index("ix_project_shares_user_id", table_name="project_shares")
    op.drop_index("ix_project_shares_project_id", table_name="project_shares")
    op.drop_table("project_shares")
    op.drop_index("ix_school_memberships_user_id", table_name="school_memberships")
    op.drop_index("ix_school_memberships_school_id", table_name="school_memberships")
    op.drop_table("school_memberships")
    op.drop_index("ix_schools_created_by_user_id", table_name="schools")
    op.drop_index("ix_schools_name", table_name="schools")
    op.drop_table("schools")
