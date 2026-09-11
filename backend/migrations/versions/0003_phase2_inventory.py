"""Phase 2: components, snapshots, snapshot_files, audits, audit_events, audit_steps, inventory_facts.

Upgrades an existing Phase 1 database without touching projects/settings/app_meta.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_phase2_inventory"
down_revision = "0002_active_root_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_components",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("root_rel", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("manifest_path", sa.Text(), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_project_components_project", "project_components", ["project_id"])

    op.create_table(
        "snapshots",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("consistency", sa.String(20), nullable=False, server_default="consistent"),
        sa.Column("result", sa.String(20), nullable=False, server_default="Complete"),
        sa.Column("roots", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("exclusions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("limits", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("included_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("excluded_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unreadable_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("included_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("limitations", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("storage_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("revision", sa.String(80), nullable=True),
        sa.Column("provenance", sa.Text(), nullable=True),
        sa.Column("capture_started_at", sa.String(40), nullable=False),
        sa.Column("capture_finished_at", sa.String(40), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_snapshots_project", "snapshots", ["project_id"])

    op.create_table(
        "snapshot_files",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("snapshot_id", sa.String(32), sa.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rel_path", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("encoding", sa.String(20), nullable=False, server_default="utf-8"),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("inclusion_reason", sa.String(40), nullable=False, server_default="included"),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_snapshot_files_snapshot", "snapshot_files", ["snapshot_id"])

    op.create_table(
        "audits",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_id", sa.String(32), sa.ForeignKey("snapshots.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False, server_default="inventory"),
        sa.Column("state", sa.String(20), nullable=False, server_default="Queued"),
        sa.Column("stage", sa.String(40), nullable=False, server_default=""),
        sa.Column("processed_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checkpoint", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.Column("finished_at", sa.String(40), nullable=True),
    )
    op.create_index("ix_audits_project", "audits", ["project_id"])
    op.create_index("ix_audits_state", "audits", ["state"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("audit_id", sa.String(32), sa.ForeignKey("audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("stage", sa.String(40), nullable=False, server_default=""),
        sa.Column("kind", sa.String(40), nullable=False, server_default="info"),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column("data", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_audit_events_audit_seq", "audit_events", ["audit_id", "seq"], unique=True)

    op.create_table(
        "audit_steps",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("audit_id", sa.String(32), sa.ForeignKey("audits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("started_at", sa.String(40), nullable=True),
        sa.Column("finished_at", sa.String(40), nullable=True),
    )
    op.create_index("ix_audit_steps_audit", "audit_steps", ["audit_id"])

    op.create_table(
        "inventory_facts",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("snapshot_id", sa.String(32), sa.ForeignKey("snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(40), nullable=False),
        sa.Column("key", sa.String(120), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("evidence", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("parser", sa.String(60), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_inventory_facts_snapshot", "inventory_facts", ["snapshot_id"])


def downgrade() -> None:
    for t in (
        "inventory_facts", "audit_steps", "audit_events", "audits",
        "snapshot_files", "snapshots", "project_components",
    ):
        op.drop_table(t)
