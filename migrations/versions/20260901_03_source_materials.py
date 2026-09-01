"""Create source material metadata. Revision ID: 20260901_03"""
from alembic import op
import sqlalchemy as sa
revision="20260901_03"; down_revision="20260901_02"; branch_labels=None; depends_on=None
def upgrade():
    op.create_table("source_materials",sa.Column("id",sa.String(36),primary_key=True),sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id"),nullable=False),sa.Column("project_id",sa.String(36),sa.ForeignKey("projects.id"),nullable=False),sa.Column("original_name",sa.String(255),nullable=False),sa.Column("mime_type",sa.String(100),nullable=False),sa.Column("byte_size",sa.Integer(),nullable=False),sa.Column("storage_key",sa.String(700),nullable=False,unique=True),sa.Column("extracted_text",sa.Text()),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
def downgrade(): op.drop_table("source_materials")
