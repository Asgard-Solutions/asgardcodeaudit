"""enforce single active registration per canonical root

Revision ID: 0002_active_root_unique
Revises: 0001_initial
Create Date: 2026-06-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_active_root_unique"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Defensive dedupe: if any pre-existing duplicate active rows exist, keep the
    # earliest and archive the rest. Rows are preserved (status change only).
    op.execute(
        """
        UPDATE projects SET status='archived'
        WHERE status='active' AND rowid NOT IN (
            SELECT MIN(rowid) FROM projects WHERE status='active' GROUP BY root_path
        )
        """
    )
    op.create_index(
        "uq_projects_active_root",
        "projects",
        ["root_path"],
        unique=True,
        sqlite_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_projects_active_root", table_name="projects")
