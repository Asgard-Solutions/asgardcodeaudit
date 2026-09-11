import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, FolderGit2, Trash2, Settings2, HardDriveDownload, Info } from "lucide-react";
import type { Mode } from "@/transport/contract";
import { useProjects, useFixtures, useCreateProject, useRemoveProject } from "@/api/hooks";
import { Card, Button, Badge, Spinner, EmptyState, Input } from "@/components/ui";
import Modal from "@/components/Modal";

function RegisterForm({ mode, onDone }: { mode: Mode; onDone: () => void }) {
  const fixtures = useFixtures();
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [fixtureId, setFixtureId] = useState<string>("");

  const canSubmit = name.trim().length > 0 && (mode === "preview" ? !!fixtureId : true);

  const submit = async () => {
    try {
      await create.mutateAsync(
        mode === "preview" ? { name: name.trim(), fixture_id: fixtureId } : { name: name.trim() }
      );
      onDone();
    } catch {
      /* toast handled in hook */
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-signal/20 bg-signal/[0.06] p-3 text-xs text-signal-soft">
        <Info className="mr-1.5 inline h-3.5 w-3.5" />
        {mode === "preview"
          ? "Preview mode registers a labeled synthetic fixture that the backend actually reads. The native Windows folder picker is a desktop feature."
          : "The native OS folder picker opens in the desktop build."}
      </div>

      <div>
        <label className="mb-1.5 block text-xs uppercase tracking-wider text-ink-faint">
          Project name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. RoofSpan API"
          data-testid="register-name-input"
          autoFocus
        />
      </div>

      {mode === "preview" && (
        <div>
          <label className="mb-1.5 block text-xs uppercase tracking-wider text-ink-faint">
            Synthetic fixture
          </label>
          {fixtures.isLoading && <Spinner />}
          <div className="space-y-2" data-testid="fixture-list">
            {fixtures.data?.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFixtureId(f.id)}
                disabled={!f.available}
                data-testid={`fixture-option-${f.id}`}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  fixtureId === f.id
                    ? "border-signal/60 bg-signal/10"
                    : "border-base-600 hover:bg-base-700"
                } ${!f.available ? "opacity-40" : ""}`}
              >
                <div className="text-sm text-ink">{f.label}</div>
                <div className="text-xs text-ink-muted">{f.description}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-ink-faint">{f.path}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          loading={create.isPending}
          disabled={!canSubmit}
          data-testid="register-submit"
        >
          Register project
        </Button>
      </div>
    </div>
  );
}

function ConfirmRemove({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const remove = useRemoveProject();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Remove the registration for <span className="text-ink">“{name}”</span>? This only removes it
        from Asgard CodeAudit. The source folder on disk is never deleted or modified.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={remove.isPending}
          data-testid="confirm-remove-btn"
          onClick={async () => {
            await remove.mutateAsync(id);
            onClose();
          }}
        >
          <Trash2 className="h-4 w-4" /> Remove registration
        </Button>
      </div>
    </div>
  );
}

export default function ProjectsPage({ mode }: { mode: Mode }) {
  const projects = useProjects();
  const [showRegister, setShowRegister] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="rise space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Projects</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Registered source roots. Registration is read-only — Asgard records the folder, it does
            not change it.
          </p>
        </div>
        <Button onClick={() => setShowRegister(true)} data-testid="register-project-btn">
          <Plus className="h-4 w-4" /> Register project
        </Button>
      </div>

      {projects.isLoading && (
        <Card className="p-6">
          <Spinner label="Loading projects…" />
        </Card>
      )}

      {projects.isError && (
        <Card className="border-gap/30 p-6">
          <p className="text-sm text-gap" data-testid="projects-error">
            Could not load projects from the backend.
          </p>
        </Card>
      )}

      {projects.data && projects.data.length === 0 && (
        <EmptyState
          icon={<FolderGit2 className="h-8 w-8" />}
          title="No projects registered"
          hint={
            mode === "preview"
              ? "Register a labeled synthetic fixture to explore the foundation. The native picker is available in the desktop build."
              : "Use the native folder picker to register a local source folder."
          }
          action={
            <Button onClick={() => setShowRegister(true)} data-testid="empty-register-btn">
              <Plus className="h-4 w-4" /> Register your first project
            </Button>
          }
        />
      )}

      {projects.data && projects.data.length > 0 && (
        <div className="grid grid-cols-1 gap-3" data-testid="projects-list">
          {projects.data.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-4 p-4" data-testid={`project-row-${p.id}`}>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-700">
                  <HardDriveDownload className="h-5 w-5 text-ink-muted" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                    <Badge tone={p.source_type === "fixture" ? "signal" : "neutral"}>
                      {p.source_type}
                    </Badge>
                    {p.status === "archived" && <Badge tone="neutral">archived</Badge>}
                  </div>
                  <div className="truncate font-mono text-xs text-ink-faint">{p.root_path}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link to={`/projects/${p.id}/settings`}>
                  <Button variant="outline" size="sm" data-testid={`project-settings-${p.id}`}>
                    <Settings2 className="h-3.5 w-3.5" /> Settings
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving({ id: p.id, name: p.name })}
                  data-testid={`project-remove-${p.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        title="Register a project"
        testid="register-modal"
      >
        <RegisterForm mode={mode} onDone={() => setShowRegister(false)} />
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove registration"
        testid="remove-modal"
      >
        {removing && <ConfirmRemove id={removing.id} name={removing.name} onClose={() => setRemoving(null)} />}
      </Modal>
    </div>
  );
}
