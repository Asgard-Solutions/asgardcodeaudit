import { getTransport } from "@/transport";
import { ApiError } from "@/transport/contract";
import type {
  Handshake,
  BackendStatus,
  BuildIdentity,
  Diagnostics,
  Fixture,
  Project,
  CreateProjectInput,
} from "@/transport/contract";

const t = () => getTransport();

export const api = {
  mode: () => t().mode,
  initSession: () => t().init(),
  pickFolder: async (): Promise<string | null> => {
    const transport = t();
    if (transport.mode !== "desktop" || !transport.selectFolder) {
      throw new ApiError(0, "The native folder picker is only available in the desktop app.");
    }
    return transport.selectFolder();
  },
  handshake: () => t().handshake(),
  // Desktop-only recovery after a post-startup backend crash.
  retryBackend: async (): Promise<Handshake> => {
    const transport = t();
    if (!transport.retryBackend) {
      throw new ApiError(0, "Backend recovery is only available in the desktop app.");
    }
    return transport.retryBackend();
  },
  onBackendUnavailable: (cb: (status: BackendStatus) => void): (() => void) => {
    const transport = t();
    if (!transport.onBackendUnavailable) return () => {};
    return transport.onBackendUnavailable(cb);
  },
  build: () => t().request<BuildIdentity>("GET", "/api/v1/build"),
  diagnostics: () => t().request<Diagnostics>("GET", "/api/v1/diagnostics"),
  fixtures: () => t().request<Fixture[]>("GET", "/api/v1/preview/fixtures"),
  listProjects: () => t().request<Project[]>("GET", "/api/v1/projects"),
  getProject: (id: string) => t().request<Project>("GET", `/api/v1/projects/${id}`),
  createProject: (input: CreateProjectInput) =>
    t().request<Project>("POST", "/api/v1/projects", input),
  updateProject: (id: string, patch: Partial<CreateProjectInput> & { status?: string }) =>
    t().request<Project>("PATCH", `/api/v1/projects/${id}`, patch),
  removeProject: (id: string) =>
    t().request<{ removed: string; source_untouched: boolean; root_path: string }>(
      "DELETE",
      `/api/v1/projects/${id}`
    ),
};
