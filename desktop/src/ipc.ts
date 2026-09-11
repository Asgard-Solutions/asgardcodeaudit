// Pure, dependency-free IPC contract + validation (unit-testable without Electron).
// This is an explicit OPERATION allow-list (exact method + route + body shape),
// not a path-prefix filter. No general local HTTP proxy is exposed.

export const IPC = {
  HANDSHAKE: "asgard:handshake",
  REQUEST: "asgard:request",
  SELECT_FOLDER: "asgard:selectFolder",
} as const;

const ID = "[0-9a-f]{32}"; // uuid4 hex, as issued by the backend

export interface Operation {
  name: string;
  method: string;
  re: RegExp;
  body?: "createProject" | "updateProject";
}

// Exactly the Phase 1 operations the renderer may invoke.
export const OPERATIONS: Operation[] = [
  { name: "build", method: "GET", re: /^\/api\/v1\/build$/ },
  { name: "diagnostics", method: "GET", re: /^\/api\/v1\/diagnostics$/ },
  { name: "listFixtures", method: "GET", re: /^\/api\/v1\/preview\/fixtures$/ },
  { name: "listProjects", method: "GET", re: /^\/api\/v1\/projects$/ },
  { name: "createProject", method: "POST", re: /^\/api\/v1\/projects$/, body: "createProject" },
  { name: "getProject", method: "GET", re: new RegExp(`^/api/v1/projects/${ID}$`) },
  { name: "updateProject", method: "PATCH", re: new RegExp(`^/api/v1/projects/${ID}$`), body: "updateProject" },
  { name: "removeProject", method: "DELETE", re: new RegExp(`^/api/v1/projects/${ID}$`) },
];

export const MAX_BODY_BYTES = 16 * 1024;
const POLICIES = new Set(["offline", "lan-only", "online"]);

export class IpcValidationError extends Error {}

export function resolveOperation(method: unknown, path: unknown): Operation {
  if (typeof method !== "string" || typeof path !== "string") {
    throw new IpcValidationError("IPC method/path must be strings.");
  }
  if (path.includes("..")) throw new IpcValidationError("Path traversal is not allowed.");
  const m = method.toUpperCase();
  const op = OPERATIONS.find((o) => o.method === m && o.re.test(path));
  if (!op) throw new IpcValidationError(`Operation not allowed: ${m} ${path}`);
  return op;
}

function assertNoUnknownKeys(obj: Record<string, unknown>, allowed: string[]): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new IpcValidationError(`Unexpected field: ${k}`);
  }
}

function isStr(v: unknown, max = 4096): v is string {
  return typeof v === "string" && v.length <= max;
}

export function validateBody(op: Operation, body: unknown): unknown {
  if (!op.body) {
    if (body !== undefined && body !== null) {
      throw new IpcValidationError(`${op.name} does not accept a body.`);
    }
    return undefined;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new IpcValidationError("Body must be an object.");
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) {
    throw new IpcValidationError("Body too large.");
  }
  const b = body as Record<string, unknown>;

  if (op.body === "createProject") {
    assertNoUnknownKeys(b, ["name", "path", "fixture_id", "tags", "profile", "source_sharing_policy"]);
    if (!isStr(b.name, 200) || b.name.trim().length === 0) {
      throw new IpcValidationError("name is required (1..200 chars).");
    }
  } else {
    assertNoUnknownKeys(b, ["name", "tags", "profile", "source_sharing_policy", "status"]);
    if (b.name !== undefined && !isStr(b.name, 200)) throw new IpcValidationError("Invalid name.");
    if (b.status !== undefined && b.status !== "active" && b.status !== "archived") {
      throw new IpcValidationError("Invalid status.");
    }
  }
  if (b.path !== undefined && !isStr(b.path)) throw new IpcValidationError("Invalid path.");
  if (b.fixture_id !== undefined && !isStr(b.fixture_id, 64)) throw new IpcValidationError("Invalid fixture_id.");
  if (b.tags !== undefined && !(Array.isArray(b.tags) && b.tags.every((t) => isStr(t, 64)))) {
    throw new IpcValidationError("Invalid tags.");
  }
  if (b.profile !== undefined && !isStr(b.profile, 64)) throw new IpcValidationError("Invalid profile.");
  if (b.source_sharing_policy !== undefined && !POLICIES.has(String(b.source_sharing_policy))) {
    throw new IpcValidationError("Invalid source_sharing_policy.");
  }
  return b;
}

export interface ValidatedRequest {
  method: string;
  path: string;
  body?: unknown;
}

export function validateApiRequest(method: unknown, path: unknown, body?: unknown): ValidatedRequest {
  const op = resolveOperation(method, path);
  const validBody = validateBody(op, body);
  return { method: op.method, path: path as string, body: validBody };
}

// Sender identity: must be the intended top-level frame AND the exact approved
// application page. A matching URL scheme alone is insufficient.
export function isTrustedFrame(
  senderUrl: string | undefined,
  isMainFrame: boolean,
  expectedUrl: string
): boolean {
  if (!isMainFrame) return false;
  if (!senderUrl) return false;
  return senderUrl === expectedUrl;
}
