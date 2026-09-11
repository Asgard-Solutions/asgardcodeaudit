import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "./client";
import type { CreateProjectInput } from "@/transport/contract";
import { ApiError } from "@/transport/contract";

export const useDiagnostics = () =>
  useQuery({ queryKey: ["diagnostics"], queryFn: api.diagnostics });

export const useBuild = () => useQuery({ queryKey: ["build"], queryFn: api.build });

export const useFixtures = () =>
  useQuery({ queryKey: ["fixtures"], queryFn: api.fixtures });

export const useProjects = () =>
  useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

export const useProject = (id: string | undefined) =>
  useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id as string),
    enabled: !!id,
  });

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.createProject(input),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Registered "${p.name}"`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : "Registration failed.";
      toast.error(msg);
    },
  });
}

export function useRemoveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Registration removed — source folder untouched.");
    },
    onError: () => toast.error("Could not remove the registration."),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CreateProjectInput> & { status?: string } }) =>
      api.updateProject(id, patch),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", p.id] });
      toast.success("Project updated.");
    },
    onError: () => toast.error("Update failed."),
  });
}
