"""Add reviewed school shared-question library.

Revision ID: 20260901_13
Revises: 20260901_12
"""
from alembic import op
import sqlalchemy as sa


revision = "20260901_13"
down_revision = "20260901_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_questions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("school_id", sa.String(length=36), nullable=False),
        sa.Column("subject", sa.String(length=100), nullable=False),
        sa.Column("grade", sa.String(length=50), nullable=False),
        sa.Column("topic", sa.String(length=200), nullable=False),
        sa.Column("question_json", sa.JSON(), nullable=False),
        sa.Column("learning_objectives", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("submitted_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"]),
        sa.ForeignKeyConstraint(["submitted_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shared_questions_school_id", "shared_questions", ["school_id"])
    op.create_index("ix_shared_questions_subject", "shared_questions", ["subject"])
    op.create_index("ix_shared_questions_grade", "shared_questions", ["grade"])
    op.create_index("ix_shared_questions_topic", "shared_questions", ["topic"])
    op.create_index("ix_shared_questions_status", "shared_questions", ["status"])
    op.create_index("ix_shared_questions_submitted_by_user_id", "shared_questions", ["submitted_by_user_id"])
    op.create_index("ix_shared_questions_reviewed_by_user_id", "shared_questions", ["reviewed_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_shared_questions_reviewed_by_user_id", table_name="shared_questions")
    op.drop_index("ix_shared_questions_submitted_by_user_id", table_name="shared_questions")
    op.drop_index("ix_shared_questions_status", table_name="shared_questions")
    op.drop_index("ix_shared_questions_topic", table_name="shared_questions")
    op.drop_index("ix_shared_questions_grade", table_name="shared_questions")
    op.drop_index("ix_shared_questions_subject", table_name="shared_questions")
    op.drop_index("ix_shared_questions_school_id", table_name="shared_questions")
    op.drop_table("shared_questions")
