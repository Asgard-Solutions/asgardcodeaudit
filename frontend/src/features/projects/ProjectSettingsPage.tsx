import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import { useProject, useUpdateProject } from "@/api/hooks";
import { Card, Button, Input, Spinner, Badge, KV } from "@/components/ui";

const POLICIES = ["offline", "lan-only", "online"] as const;

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const project = useProject(id);
  const update = useUpdateProject();

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [policy, setPolicy] = useState<(typeof POLICIES)[number]>("offline");

  useEffect(() => {
    if (project.data) {
      setName(project.data.name);
      setTags(project.data.tags.join(", "));
      setPolicy((project.data.source_sharing_policy as (typeof POLICIES)[number]) ?? "offline");
    }
  }, [project.data]);

  if (project.isLoading) return <Spinner label="Loading project…" />;
  if (project.isError || !project.data)
    return (
      <Card className="border-gap/30 p-6">
        <p className="text-sm text-gap" data-testid="project-load-error">
          Project not found.
        </p>
        <Link to="/projects" className="mt-3 inline-block text-sm text-signal-soft">
          Back to projects
        </Link>
      </Card>
    );

  const p = project.data;

  const save = () =>
    update.mutate({
      id: p.id,
      patch: {
        name: name.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        source_sharing_policy: policy,
      },
    });

  return (
    <div className="rise max-w-3xl space-y-6">
      <div>
        <Link to="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Projects
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{p.name}</h1>
          <Badge tone={p.source_type === "fixture" ? "signal" : "neutral"}>{p.source_type}</Badge>
        </div>
      </div>

      <Card className="p-6">
        <h2 className="mb-3 font-display text-base text-ink">Summary</h2>
        <KV k="Canonical root" v={p.root_path} mono />
        <KV k="Original path" v={p.original_path} mono />
        <KV k="Project ID" v={p.id} mono />
        <KV k="Profile" v={p.profile} />
        <KV k="Registered" v={new Date(p.created_at).toLocaleString()} />
      </Card>

      <Card className="p-6" data-testid="settings-form">
        <h2 className="mb-4 font-display text-base text-ink">Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-ink-faint">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="settings-name" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-ink-faint">
              Tags (comma-separated)
            </label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} data-testid="settings-tags" placeholder="api, python" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-ink-faint">
              Source-sharing policy
            </label>
            <div className="flex gap-2" data-testid="settings-policy">
              {POLICIES.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setPolicy(opt)}
                  className={`rounded-md border px-3 py-1.5 text-sm capitalize transition-colors ${
                    policy === opt ? "border-signal/60 bg-signal/10 text-signal-soft" : "border-base-600 text-ink-muted hover:bg-base-700"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              Controls whether source may leave the machine in later provider phases. Default is
              offline. No providers are configured in this phase.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={save} loading={update.isPending} data-testid="settings-save">
            Save changes
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="flex items-center gap-2 font-display text-base text-ink">
          <Lock className="h-4 w-4 text-ink-faint" /> Inventory & audits
        </h2>
        <p className="mt-1 text-sm text-ink-muted" data-testid="inventory-placeholder">
          Source inventory and audits are not part of this phase. Nothing here is fabricated — real
          inventory arrives in Phase 2 and will read this project's snapshot through the backend.
        </p>
      </Card>
    </div>
  );
}
