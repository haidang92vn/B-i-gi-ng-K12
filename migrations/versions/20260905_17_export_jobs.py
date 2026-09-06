"""Add durable Redis-backed SCORM export job state.

Revision ID: 20260905_17
Revises: 20260902_16
"""
from alembic import op
import sqlalchemy as sa


revision = "20260905_17"
down_revision = "20260902_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "export_jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("job_type", sa.String(length=30), nullable=False, server_default="scorm2004"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("input_revision", sa.Integer(), nullable=False),
        sa.Column("export_record_id", sa.String(length=36), sa.ForeignKey("export_records.id"), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message_safe", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    for name, columns in (
        ("ix_export_jobs_project_id", ["project_id"]),
        ("ix_export_jobs_user_id", ["user_id"]),
        ("ix_export_jobs_status", ["status"]),
        ("ix_export_jobs_export_record_id", ["export_record_id"]),
    ):
        op.create_index(name, "export_jobs", columns)


def downgrade() -> None:
    for name in ("ix_export_jobs_export_record_id", "ix_export_jobs_status", "ix_export_jobs_user_id", "ix_export_jobs_project_id"):
        op.drop_index(name, table_name="export_jobs")
    op.drop_table("export_jobs")
