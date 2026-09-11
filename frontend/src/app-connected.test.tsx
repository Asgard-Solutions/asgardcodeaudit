import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { render, screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// CONNECTED renderer test. It exercises the ACTUAL renderer initialization
// sequence (App -> createTransport -> DesktopTransport -> window.asgard) and the
// ACTUAL client/transport code against a REAL loopback HTTP backend.
//
// SUBSTITUTION (labeled): the Electron main process + preload are MODELLED by an
// in-test bridge that applies the same serializable {ok,...} envelope contract
// and forwards only dedicated/allow-listed operations. The real allow-list,
// envelope and sender-frame logic are separately exercised in the desktop
// project's ipc.test.ts / connected.test.ts. No native Electron runs here.

let server: http.Server;
let baseUrl = "";
let projects: Array<Record<string, unknown>> = [];

// controllable post-startup crash emitter (models main -> renderer notification)
let unavailableCb: ((s: { reason: string; message: string }) => void) | null = null;

function ok(data: unknown) {
  return { ok: true, data };
}
function fail(message: string, status: number, code?: string) {
  return { ok: false, error: { message, status, code } };
}

const ALLOWED = new Set([
  "GET /api/v1/build",
  "GET /api/v1/diagnostics",
  "GET /api/v1/preview/fixtures",
  "GET /api/v1/projects",
  "POST /api/v1/projects",
]);

async function forward(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) return fail((data?.detail?.message ?? `failed ${res.status}`) as string, res.status, data?.detail?.code);
  return ok(data);
}

function installBridge() {
  (window as unknown as { asgard: unknown }).asgard = {
    handshake: async () => forward("GET", "/api/v1/startup/handshake"),
    request: async (method: string, path: string, body?: unknown) => {
      // dedicated handshake never travels this channel
      if (path === "/api/v1/startup/handshake") return fail("Operation not allowed", 400, "ipc_validation");
      const key = `${method.toUpperCase()} ${path.replace(/\/[0-9a-f]{32}$/, "/:id")}`;
      if (!ALLOWED.has(key) && !/^(GET|PATCH|DELETE) \/api\/v1\/projects\/:id$/.test(key)) {
        return fail(`Operation not allowed: ${method} ${path}`, 400, "ipc_validation");
      }
      return forward(method, path, body);
    },
    selectFolder: async () => ok("/picked/source/folder"),
    retryBackend: async () => forward("GET", "/api/v1/startup/handshake"),
    onBackendUnavailable: (cb: (s: { reason: string; message: string }) => void) => {
      unavailableCb = cb;
      return () => {
        if (unavailableCb === cb) unavailableCb = null;
      };
    },
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("Content-Type", "application/json");
    if (url === "/api/v1/startup/handshake") {
      res.end(JSON.stringify({ status: "ready", name: "Asgard CodeAudit", version: "0.1.0", source_revision: null, mode: "desktop" }));
    } else if (url === "/api/v1/build") {
      res.end(JSON.stringify({ name: "Asgard CodeAudit", version: "0.1.0", schema_version: "1", source_revision: null, source_dirty: null, python_version: "3.13.15", python_implementation: "CPython", sqlite_runtime: "3.53.1", platform: "linux", arch: "arm64" }));
    } else if (url === "/api/v1/projects" && req.method === "GET") {
      res.end(JSON.stringify(projects));
    } else if (url === "/api/v1/projects" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const b = JSON.parse(raw || "{}");
        const p = { id: "a".repeat(32), name: b.name, root_path: b.path ?? "/picked/source/folder", original_path: b.path ?? "/picked/source/folder", source_type: "local", fixture_id: null, tags: [], profile: "default", source_sharing_policy: "offline", status: "active", created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z" };
        projects.push(p);
        res.end(JSON.stringify(p));
      });
    } else if (url === "/api/v1/diagnostics") {
      res.end(JSON.stringify({ build: { name: "Asgard CodeAudit", version: "0.1.0", schema_version: "1", source_revision: null, source_dirty: null, python_version: "3.13.15", python_implementation: "CPython", sqlite_runtime: "3.53.1", platform: "linux", arch: "arm64" }, mode: "desktop", storage: { data_dir: "/data", db_path: "/data/app.db", sqlite: { journal_mode: "delete", foreign_keys: true, synchronous: 2, busy_timeout_ms: 5000 } }, credential_store: { available: false, note: "n/a" }, optional_scanners: {}, preview_limitations: [] }));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  projects = [];
  unavailableCb = null;
  vi.stubEnv("VITE_ASGARD_MODE", "desktop");
  installBridge();
});

function renderApp() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("connected startup + navigation + registration (item 1 & 2)", () => {
  it("boots via the dedicated handshake (not the request allow-list) and reaches Overview", async () => {
    renderApp();
    // startup handshake must succeed: it does NOT go through the request channel
    expect(await screen.findByTestId("backend-ready")).toBeInTheDocument();
    expect(screen.getByTestId("mode-badge")).toHaveTextContent(/Desktop/i);
    await waitFor(() => expect(screen.getByTestId("stat-mode")).toHaveTextContent(/desktop/i));
  });

  it("navigates Overview -> Projects, picks a folder, registers, and re-reads the list", async () => {
    renderApp();
    await screen.findByTestId("backend-ready");

    fireEvent.click(screen.getByTestId("nav-projects"));
    expect(await screen.findByTestId("register-project-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("register-project-btn"));
    fireEvent.change(await screen.findByTestId("register-name-input"), {
      target: { value: "RoofSpan API" },
    });
    fireEvent.click(screen.getByTestId("pick-folder-btn"));
    await waitFor(() => expect(screen.getByTestId("picked-path")).toHaveTextContent("/picked/source/folder"));
    fireEvent.click(screen.getByTestId("register-submit"));

    const list = await screen.findByTestId("projects-list");
    expect(within(list).getByText("RoofSpan API")).toBeInTheDocument();

    // navigate to Diagnostics (route change keeps working)
    fireEvent.click(screen.getByTestId("nav-diagnostics"));
    // back to Overview reflects the newly registered project count
    fireEvent.click(screen.getByTestId("nav-overview"));
    await waitFor(() => expect(screen.getByTestId("stat-registered-projects")).toHaveTextContent("1"));
  });
});

describe("post-readiness crash -> unavailable -> retry (item 1 recovery)", () => {
  it("shows the unavailable state and recovers on Retry, re-reading data", async () => {
    renderApp();
    await screen.findByTestId("backend-ready");

    // model a post-startup backend crash notification from main
    expect(unavailableCb).toBeTypeOf("function");
    act(() => unavailableCb!({ reason: "crashed", message: "The local analysis backend stopped unexpectedly." }));

    expect(await screen.findByTestId("backend-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("backend-unavailable-message")).toHaveTextContent(/stopped unexpectedly/i);

    fireEvent.click(screen.getByTestId("backend-retry"));
    // recovery success returns to the connected application
    expect(await screen.findByTestId("backend-ready")).toBeInTheDocument();
  });
});
