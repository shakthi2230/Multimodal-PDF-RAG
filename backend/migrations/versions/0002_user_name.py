"""Add a display name to user accounts."""
from alembic import op
import sqlalchemy as sa

revision = "0002_user_name"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("name", sa.String(length=100), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("users", "name")
