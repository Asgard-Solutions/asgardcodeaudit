import { Link } from "react-router-dom";
import { FolderGit2, Database, ShieldCheck, ArrowRight, Lock } from "lucide-react";
import type { Mode } from "@/transport/contract";
import { useProjects, useBuild } from "@/api/hooks";
import { Card, Spinner, Button, Badge } from "@/components/ui";

function Stat({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-ink-faint">{label}</span>
        <span className="text-ink-faint">{icon}</span>
      </div>
      <div className="mt-3 font-display text-3xl text-ink" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </div>
    </Card>
  );
}

const LATER_PHASES = [
  "Snapshot & inventory (Phase 2)",
  "Rules, evidence & findings (Phase 3)",
  "OpenAI / LM Studio review (Phase 4)",
  "Prompt Studio & comparison (Phase 5)",
  "Backup, installer & release (Phase 6)",
];

export default function OverviewPage({ mode }: { mode: Mode }) {
  const projects = useProjects();
  const build = useBuild();

  return (
    <div className="rise space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Overview</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Foundation status for this workspace. No audits have run yet — scanning arrives in a later
          phase, and this screen never shows a made-up readiness score.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Registered projects"
          value={projects.isLoading ? "…" : projects.data?.length ?? 0}
          icon={<FolderGit2 className="h-4 w-4" />}
        />
        <Stat
          label="Storage"
          value={<span className="text-xl">SQLite · rollback</span>}
          icon={<Database className="h-4 w-4" />}
        />
        <Stat
          label="Mode"
          value={<span className="text-xl capitalize">{mode}</span>}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base text-ink">Your projects</h2>
            <Link to="/projects">
              <Button variant="outline" size="sm" data-testid="overview-go-projects">
                Manage <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="mt-4">
            {projects.isLoading && <Spinner />}
            {projects.isError && (
              <p className="text-sm text-gap" data-testid="overview-projects-error">
                Could not load projects.
              </p>
            )}
            {projects.data && projects.data.length === 0 && (
              <p className="text-sm text-ink-muted" data-testid="overview-empty">
                No projects registered yet. Head to Projects to register a source folder.
              </p>
            )}
            {projects.data && projects.data.length > 0 && (
              <ul className="divide-y divide-line">
                {projects.data.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{p.name}</div>
                      <div className="truncate font-mono text-xs text-ink-faint">{p.root_path}</div>
                    </div>
                    <Badge tone={p.source_type === "fixture" ? "signal" : "neutral"}>
                      {p.source_type}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="flex items-center gap-2 font-display text-base text-ink">
            <Lock className="h-4 w-4 text-ink-faint" /> Not yet available
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Planned capabilities. Listed for transparency — they are not clickable and produce no
            results in this phase.
          </p>
          <ul className="mt-4 space-y-2" data-testid="later-phases">
            {LATER_PHASES.map((x) => (
              <li key={x} className="flex items-center gap-2 text-sm text-ink-faint">
                <span className="h-1.5 w-1.5 rounded-full bg-base-600" />
                {x}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {build.data && (
        <p className="font-mono text-xs text-ink-faint" data-testid="overview-runtime">
          runtime · python {build.data.python_version} · sqlite {build.data.sqlite_runtime} ·{" "}
          {build.data.arch}
        </p>
      )}
    </div>
  );
}
