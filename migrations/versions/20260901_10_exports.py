"""Persist ready SCORM export metadata."""
from alembic import op
import sqlalchemy as sa
revision="20260901_10"; down_revision="20260901_05"; branch_labels=None; depends_on=None
def upgrade():
    op.create_table("export_records",sa.Column("id",sa.String(36),primary_key=True),sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id"),nullable=False),sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id")),sa.Column("filename",sa.String(300),nullable=False),sa.Column("storage_key",sa.String(700),nullable=False,unique=True),sa.Column("byte_size",sa.Integer(),nullable=False),sa.Column("status",sa.String(20),nullable=False,server_default="ready"),sa.Column("validation_json",sa.JSON(),nullable=False),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
def downgrade(): op.drop_table("export_records")
