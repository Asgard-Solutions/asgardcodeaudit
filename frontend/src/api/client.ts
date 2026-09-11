import { getTransport } from "@/transport";
import { ApiError } from "@/transport/contract";
import type {
  Handshake,
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
  handshake: () => t().request<Handshake>("GET", "/api/v1/startup/handshake"),
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
