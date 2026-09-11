// Pure, dependency-free IPC contract + validation (unit-testable without Electron).
// The renderer may only reach a narrow, allow-listed surface. No arbitrary
// filesystem, shell, or HTTP access is ever exposed.

export const IPC = {
  HANDSHAKE: "asgard:handshake",
  REQUEST: "asgard:request",
  SELECT_FOLDER: "asgard:selectFolder",
} as const;

export const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

// Only the versioned business API is reachable; nothing outside /api/v1.
export const ALLOWED_PATH_RE = /^\/api\/v1\/[A-Za-z0-9._/-]*$/;

export interface ValidatedRequest {
  method: string;
  path: string;
}

export function validateApiRequest(method: unknown, path: unknown): ValidatedRequest {
  if (typeof method !== "string" || !ALLOWED_METHODS.has(method.toUpperCase())) {
    throw new Error(`IPC method not allowed: ${String(method)}`);
  }
  if (typeof path !== "string" || !ALLOWED_PATH_RE.test(path) || path.includes("..")) {
    throw new Error(`IPC path not allowed: ${String(path)}`);
  }
  return { method: method.toUpperCase(), path };
}
