import { CheckCircle2, XCircle, Database, ShieldCheck, Boxes } from "lucide-react";
import { useDiagnostics } from "@/api/hooks";
import { Card, Spinner, KV, Badge } from "@/components/ui";

function Yes({ v }: { v: boolean }) {
  return v ? (
    <span className="inline-flex items-center gap-1 text-verified">
      <CheckCircle2 className="h-4 w-4" /> yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-ink-faint">
      <XCircle className="h-4 w-4" /> no
    </span>
  );
}

export default function DiagnosticsPage() {
  const diag = useDiagnostics();

  return (
    <div className="rise max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Diagnostics</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Live values from the running backend build. Nothing here is hard-coded from a README.
        </p>
      </div>

      {diag.isLoading && (
        <Card className="p-6">
          <Spinner label="Reading diagnostics…" />
        </Card>
      )}
      {diag.isError && (
        <Card className="border-gap/30 p-6">
          <p className="text-sm text-gap">Could not read diagnostics.</p>
        </Card>
      )}

      {diag.data && (
        <>
          <Card className="p-6" data-testid="diag-build">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base text-ink">
              <ShieldCheck className="h-4 w-4 text-signal" /> Build identity
            </h2>
            <KV k="Application" v={`${diag.data.build.name} v${diag.data.build.version}`} />
            <KV k="Schema version" v={diag.data.build.schema_version} mono />
            <KV
              k="Source revision"
              v={
                <span className="font-mono">
                  {diag.data.build.source_revision ?? "unknown"}
                  {diag.data.build.source_dirty ? " (dirty)" : ""}
                </span>
              }
            />
            <KV k="Python" v={`${diag.data.build.python_implementation} ${diag.data.build.python_version}`} mono />
            <KV k="Platform / arch" v={`${diag.data.build.platform} · ${diag.data.build.arch}`} mono />
            <KV k="Mode" v={<Badge tone={diag.data.mode === "preview" ? "signal" : "verified"}>{diag.data.mode}</Badge>} />
          </Card>

          <Card className="p-6" data-testid="diag-storage">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base text-ink">
              <Database className="h-4 w-4 text-signal" /> SQLite storage
            </h2>
            <KV k="SQLite runtime" v={diag.data.build.sqlite_runtime} mono />
            <KV k="Journal mode" v={<Badge tone="verified">{diag.data.storage.sqlite.journal_mode}</Badge>} />
            <KV k="Foreign keys" v={<Yes v={diag.data.storage.sqlite.foreign_keys} />} />
            <KV k="Synchronous" v={String(diag.data.storage.sqlite.synchronous)} mono />
            <KV k="Busy timeout" v={`${diag.data.storage.sqlite.busy_timeout_ms} ms`} mono />
            <KV k="Database path" v={diag.data.storage.db_path} mono />
            <KV k="App data dir" v={diag.data.storage.data_dir} mono />
            <p className="mt-3 text-xs text-ink-faint">
              Phase 1 uses rollback-journal mode (not WAL): the preview service runtime bundles an
              older SQLite (see build). WAL is deferred until the packaged version is validated.
            </p>
          </Card>

          <Card className="p-6" data-testid="diag-tools">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base text-ink">
              <Boxes className="h-4 w-4 text-signal" /> Credential store & optional scanners
            </h2>
            <KV k="OS credential store" v={<Yes v={diag.data.credential_store.available} />} />
            {Object.entries(diag.data.optional_scanners).map(([name, s]) => (
              <KV key={name} k={name} v={<span className="text-ink-muted">{s.installed ? "installed" : "not installed"} · {s.status}</span>} />
            ))}
            <p className="mt-2 text-xs text-ink-faint">{diag.data.credential_store.note}</p>
          </Card>

          {diag.data.preview_limitations.length > 0 && (
            <Card className="border-signal/25 p-6" data-testid="diag-limits">
              <h2 className="mb-3 font-display text-base text-signal-soft">Preview limitations</h2>
              <ul className="space-y-2">
                {diag.data.preview_limitations.map((l) => (
                  <li key={l} className="flex items-start gap-2 text-sm text-ink-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                    {l}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
