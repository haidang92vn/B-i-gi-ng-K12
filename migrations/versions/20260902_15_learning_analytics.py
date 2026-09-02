"""Add anonymized K12Online report-import analytics tables.

Revision ID: 20260902_15
Revises: 20260902_14
"""
from alembic import op
import sqlalchemy as sa


revision = "20260902_15"
down_revision = "20260902_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_imports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("school_id", sa.String(length=36), nullable=False),
        sa.Column("imported_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("source_type", sa.String(length=40), nullable=False, server_default="k12online_report"),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("source_sha256", sa.String(length=64), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("accepted_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mapping_json", sa.JSON(), nullable=False),
        sa.Column("error_summary_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"]),
        sa.ForeignKeyConstraint(["imported_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("school_id", "source_sha256", name="uq_analytics_imports_school_source"),
    )
    op.create_index("ix_analytics_imports_school_id", "analytics_imports", ["school_id"])
    op.create_index("ix_analytics_imports_imported_by_user_id", "analytics_imports", ["imported_by_user_id"])
    op.create_table(
        "learning_analytics",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("import_id", sa.String(length=36), nullable=False),
        sa.Column("school_id", sa.String(length=36), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("learner_token", sa.String(length=64), nullable=False),
        sa.Column("course_external_id", sa.String(length=200), nullable=False),
        sa.Column("course_title", sa.String(length=300), nullable=True),
        sa.Column("class_code", sa.String(length=100), nullable=True),
        sa.Column("lesson_external_id", sa.String(length=200), nullable=False),
        sa.Column("lesson_title", sa.String(length=300), nullable=True),
        sa.Column("activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Float(), nullable=True),
        sa.Column("completion_ratio", sa.Float(), nullable=True),
        sa.Column("completion_status", sa.String(length=40), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("max_score", sa.Float(), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=True),
        sa.Column("correct_answers", sa.Integer(), nullable=True),
        sa.Column("total_questions", sa.Integer(), nullable=True),
        sa.Column("correct_ratio", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["analytics_imports.id"]),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("import_id", "row_number", name="uq_learning_analytics_import_row"),
    )
    for name, columns in (("ix_learning_analytics_import_id", ["import_id"]), ("ix_learning_analytics_school_id", ["school_id"]), ("ix_learning_analytics_learner_token", ["learner_token"]), ("ix_learning_analytics_course_external_id", ["course_external_id"]), ("ix_learning_analytics_lesson_external_id", ["lesson_external_id"]), ("ix_learning_analytics_activity_at", ["activity_at"])):
        op.create_index(name, "learning_analytics", columns)


def downgrade() -> None:
    for name in ("ix_learning_analytics_activity_at", "ix_learning_analytics_lesson_external_id", "ix_learning_analytics_course_external_id", "ix_learning_analytics_learner_token", "ix_learning_analytics_school_id", "ix_learning_analytics_import_id"):
        op.drop_index(name, table_name="learning_analytics")
    op.drop_table("learning_analytics")
    op.drop_index("ix_analytics_imports_imported_by_user_id", table_name="analytics_imports")
    op.drop_index("ix_analytics_imports_school_id", table_name="analytics_imports")
    op.drop_table("analytics_imports")
