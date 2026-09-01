"""Persist non-sensitive AI generation metadata."""
from alembic import op
import sqlalchemy as sa

revision = "20260901_05"
down_revision = "20260901_04"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "generation_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("model", sa.String(100)),
        sa.Column("request_id", sa.String(200)),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("operation", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="succeeded"),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_generation_runs_user_id", "generation_runs", ["user_id"])
    op.create_index("ix_generation_runs_project_id", "generation_runs", ["project_id"])


def downgrade():
    op.drop_index("ix_generation_runs_project_id", table_name="generation_runs")
    op.drop_index("ix_generation_runs_user_id", table_name="generation_runs")
    op.drop_table("generation_runs")
