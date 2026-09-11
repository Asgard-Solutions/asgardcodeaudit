// Shared transport contract (mirrors packages/contracts in the deliverable repo).
// The same request/response shapes are used by the desktop (IPC->loopback) and
// preview (same-origin) adapters, so business logic and API schema are identical.

export type Mode = "preview" | "desktop";

export interface BuildIdentity {
  name: string;
  version: string;
  schema_version: string;
  source_revision: string | null;
  source_dirty: boolean | null;
  python_version: string;
  python_implementation: string;
  sqlite_runtime: string;
  platform: string;
  arch: string;
}

export interface Handshake {
  status: string;
  name: string;
  version: string;
  source_revision: string | null;
  mode: Mode;
}

export interface Diagnostics {
  build: BuildIdentity;
  mode: Mode;
  storage: {
    data_dir: string;
    db_path: string;
    sqlite: {
      journal_mode: string;
      foreign_keys: boolean;
      synchronous: number;
      busy_timeout_ms: number;
    };
  };
  credential_store: { available: boolean; note: string; [k: string]: unknown };
  optional_scanners: Record<string, { installed: boolean; status: string }>;
  preview_limitations: string[];
}

export interface Fixture {
  id: string;
  label: string;
  description: string;
  path: string;
  available: boolean;
}

export interface Project {
  id: string;
  name: string;
  root_path: string;
  original_path: string;
  source_type: "local" | "fixture";
  fixture_id: string | null;
  tags: string[];
  profile: string;
  source_sharing_policy: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  fixture_id?: string;
  path?: string;
  tags?: string[];
  profile?: string;
  source_sharing_policy?: "offline" | "lan-only" | "online";
}

export interface BackendStatus {
  reason: string;
  message: string;
}

export interface Transport {
  readonly mode: Mode;
  init(): Promise<void>;
  // Dedicated, typed startup readiness/identity operation. Consistent across
  // adapters; never travels the generic request allow-list.
  handshake(): Promise<Handshake>;
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
  selectFolder?(): Promise<string | null>;
  // Desktop-only recovery surface (undefined in preview).
  retryBackend?(): Promise<Handshake>;
  onBackendUnavailable?(cb: (status: BackendStatus) => void): () => void;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
