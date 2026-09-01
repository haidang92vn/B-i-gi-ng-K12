"""Create encrypted per-teacher AI credentials."""
from alembic import op
import sqlalchemy as sa
revision="20260901_04"; down_revision="20260901_03"; branch_labels=None; depends_on=None
def upgrade(): op.create_table("ai_credentials",sa.Column("id",sa.String(36),primary_key=True),sa.Column("user_id",sa.String(36),sa.ForeignKey("users.id"),nullable=False),sa.Column("provider",sa.String(30),nullable=False),sa.Column("label",sa.String(100)),sa.Column("encrypted_secret",sa.Text(),nullable=False),sa.Column("secret_last4",sa.String(4),nullable=False),sa.Column("model_default",sa.String(100)),sa.Column("status",sa.String(20),nullable=False,server_default="active"),sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),sa.Column("updated_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False))
def downgrade(): op.drop_table("ai_credentials")
