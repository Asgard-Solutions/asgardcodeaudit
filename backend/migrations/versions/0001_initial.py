"""initial schema: projects, project_settings, app_meta

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("root_path", sa.Text(), nullable=False),
        sa.Column("original_path", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(length=20), nullable=False, server_default="local"),
        sa.Column("fixture_id", sa.String(length=64), nullable=True),
        sa.Column("tags", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("profile", sa.String(length=40), nullable=False, server_default="standard-static"),
        sa.Column("source_sharing_policy", sa.String(length=20), nullable=False, server_default="offline"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_projects_root_path", "projects", ["root_path"])
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "project_settings",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("exclusions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("associated_roots", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("project_id", name="uq_project_settings_project_id"),
    )

    op.create_table(
        "app_meta",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("app_meta")
    op.drop_table("project_settings")
    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_index("ix_projects_root_path", table_name="projects")
    op.drop_table("projects")
