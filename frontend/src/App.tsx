import { useCallback, useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { createTransport } from "@/transport";
import type { Handshake } from "@/transport/contract";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui";
import OverviewPage from "@/features/overview/OverviewPage";
import ProjectsPage from "@/features/projects/ProjectsPage";
import ProjectSettingsPage from "@/features/projects/ProjectSettingsPage";
import DiagnosticsPage from "@/features/diagnostics/DiagnosticsPage";

type BootState =
  | { status: "loading" }
  | { status: "ready"; identity: Handshake }
  | { status: "error"; message: string };

export default function App() {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });

  const start = useCallback(async () => {
    setBoot({ status: "loading" });
    try {
      await createTransport();
      await api.initSession();
      const identity = await api.handshake();
      setBoot({ status: "ready", identity });
    } catch (e) {
      setBoot({
        status: "error",
        message: e instanceof Error ? e.message : "The backend did not report readiness.",
      });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  if (boot.status === "loading") {
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4" data-testid="boot-loading">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-signal/15 ring-1 ring-signal/30">
          <ShieldCheck className="h-6 w-6 text-signal" />
        </div>
        <div className="flex items-center gap-2 text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting to the Asgard CodeAudit backend…
        </div>
      </div>
    );
  }

  if (boot.status === "error") {
    return (
      <div className="flex h-full min-h-screen flex-col items-center justify-center px-6" data-testid="boot-error">
        <div className="w-full max-w-md rounded-xl border border-gap/30 bg-base-850 p-6 text-center shadow-panel">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gap/15">
            <ShieldAlert className="h-6 w-6 text-gap" />
          </div>
          <h1 className="font-display text-lg text-ink">Backend not ready</h1>
          <p className="mt-2 text-sm text-ink-muted" data-testid="boot-error-message">
            {boot.message}
          </p>
          <p className="mt-2 text-xs text-ink-faint">
            No connected state is shown until the backend confirms readiness.
          </p>
          <Button className="mt-5" onClick={() => void start()} data-testid="boot-retry">
            Retry connection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Layout identity={boot.identity}>
      <Routes>
        <Route path="/" element={<OverviewPage mode={boot.identity.mode} />} />
        <Route path="/projects" element={<ProjectsPage mode={boot.identity.mode} />} />
        <Route path="/projects/:id/settings" element={<ProjectSettingsPage />} />
        <Route path="/diagnostics" element={<DiagnosticsPage />} />
      </Routes>
    </Layout>
  );
}
