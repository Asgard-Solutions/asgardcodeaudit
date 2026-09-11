import { NavLink } from "react-router-dom";
import { LayoutDashboard, FolderGit2, Activity, ShieldCheck, Cpu } from "lucide-react";
import type { Handshake } from "@/transport/contract";
import { cn } from "@/lib/utils";
import { Badge } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true, testid: "nav-overview" },
  { to: "/projects", label: "Projects", icon: FolderGit2, testid: "nav-projects" },
  { to: "/diagnostics", label: "Diagnostics", icon: Activity, testid: "nav-diagnostics" },
];

export default function Layout({
  identity,
  children,
}: {
  identity: Handshake;
  children: React.ReactNode;
}) {
  const isPreview = identity.mode === "preview";
  return (
    <div className="flex h-full min-h-screen">
      {/* Nav rail */}
      <aside className="flex w-64 flex-col border-r border-line bg-base-850/60">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-signal/15 ring-1 ring-signal/30">
            <ShieldCheck className="h-5 w-5 text-signal" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold tracking-tight text-ink">
              Asgard
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              CodeAudit
            </div>
          </div>
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-3" data-testid="primary-nav">
          {NAV.map(({ to, label, icon: Icon, end, testid }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              data-testid={testid}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-base-700 text-ink"
                    : "text-ink-muted hover:bg-base-800 hover:text-ink"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto px-4 py-4">
          <div className="rounded-lg border border-line bg-base-900/60 p-3">
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Cpu className="h-3.5 w-3.5" />
              Read-only v1
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Audited source is never modified, executed, or installed.
            </p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-base-900/70 px-8 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-ink-muted" data-testid="backend-ready">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-verified opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-verified" />
              </span>
              Backend ready
            </span>
            <span className="font-mono text-xs text-ink-faint" data-testid="build-identity">
              {identity.name} · v{identity.version}
              {identity.source_revision ? ` · ${identity.source_revision}` : ""}
            </span>
          </div>
          <Badge
            tone={isPreview ? "signal" : "verified"}
            data-testid="mode-badge"
            className="uppercase tracking-wide"
          >
            {isPreview ? "Preview harness" : "Desktop"}
          </Badge>
        </header>

        {isPreview && (
          <div
            className="border-b border-signal/20 bg-signal/[0.06] px-8 py-2 text-xs text-signal-soft"
            data-testid="preview-banner"
          >
            Development preview — registration is limited to labeled synthetic fixtures. This is not
            your machine and does not stand in for the Windows native folder picker.
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
