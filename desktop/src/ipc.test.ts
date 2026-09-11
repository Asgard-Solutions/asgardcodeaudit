import { describe, it, expect } from "vitest";
import {
  resolveOperation,
  validateBody,
  validateApiRequest,
  isTrustedFrame,
  ipcOk,
  ipcFail,
  sanitizeMessage,
  IpcValidationError,
  IPC,
} from "./ipc";
import { APP_ORIGIN } from "./protocol";

describe("IPC operation allow-list (not a prefix filter)", () => {
  it("accepts exactly the approved operations", () => {
    expect(resolveOperation("GET", "/api/v1/projects").name).toBe("listProjects");
    expect(resolveOperation("post", "/api/v1/projects").name).toBe("createProject");
    expect(resolveOperation("DELETE", "/api/v1/projects/" + "a".repeat(32)).name).toBe("removeProject");
    expect(resolveOperation("GET", "/api/v1/diagnostics").name).toBe("diagnostics");
  });

  it("keeps the public startup handshake OUT of the generic request allow-list", () => {
    // The dedicated HANDSHAKE operation handles readiness; it must never be a
    // valid generic REQUEST target.
    expect(() => resolveOperation("GET", "/api/v1/startup/handshake")).toThrow(IpcValidationError);
  });

  it("rejects unsupported operations under /api/v1 (the old prefix hole)", () => {
    expect(() => resolveOperation("DELETE", "/api/v1/not-an-approved-operation")).toThrow(IpcValidationError);
    expect(() => resolveOperation("GET", "/api/v1/projects/extra/segment")).toThrow();
    expect(() => resolveOperation("POST", "/api/v1/diagnostics")).toThrow(); // method mismatch
  });

  it("rejects malformed identifiers and traversal", () => {
    expect(() => resolveOperation("GET", "/api/v1/projects/not-a-hex-id")).toThrow();
    expect(() => resolveOperation("GET", "/api/v1/projects/" + "a".repeat(10))).toThrow();
    expect(() => resolveOperation("GET", "/api/v1/../../secret")).toThrow();
  });

  it("validates create/update bodies and rejects unexpected/oversized fields", () => {
    const create = resolveOperation("POST", "/api/v1/projects");
    expect(validateBody(create, { name: "ok", fixture_id: "py-fastapi-sample" })).toBeTruthy();
    expect(() => validateBody(create, {})).toThrow(); // missing name
    expect(() => validateBody(create, { name: "ok", bogus: 1 })).toThrow(); // unexpected field
    expect(() => validateBody(create, { name: "x".repeat(5000) })).toThrow(); // too long
    const update = resolveOperation("PATCH", "/api/v1/projects/" + "b".repeat(32));
    expect(() => validateBody(update, { status: "weird" })).toThrow();
    expect(validateBody(update, { status: "archived" })).toBeTruthy();
  });

  it("full validateApiRequest happy path", () => {
    const v = validateApiRequest("POST", "/api/v1/projects", { name: "A", fixture_id: "f" });
    expect(v.method).toBe("POST");
  });
});

describe("IPC sender-frame trust (parsed origin, not exact URL, not prefix)", () => {
  it("accepts the exact approved origin for any legitimate application route", () => {
    expect(isTrustedFrame(`${APP_ORIGIN}/`, true, APP_ORIGIN)).toBe(true);
    expect(isTrustedFrame(`${APP_ORIGIN}/index.html`, true, APP_ORIGIN)).toBe(true);
    expect(isTrustedFrame(`${APP_ORIGIN}/projects`, true, APP_ORIGIN)).toBe(true);
    expect(isTrustedFrame(`${APP_ORIGIN}/diagnostics`, true, APP_ORIGIN)).toBe(true);
    expect(isTrustedFrame(`${APP_ORIGIN}/projects/abc/settings`, true, APP_ORIGIN)).toBe(true);
  });

  it("rejects sub-frames, other authorities, ports, credentials, and other schemes", () => {
    expect(isTrustedFrame(`${APP_ORIGIN}/projects`, false, APP_ORIGIN)).toBe(false); // sub-frame
    expect(isTrustedFrame("app://evil/index.html", true, APP_ORIGIN)).toBe(false); // wrong authority
    expect(isTrustedFrame("app://asgard:8080/index.html", true, APP_ORIGIN)).toBe(false); // port
    expect(isTrustedFrame("app://user:pass@asgard/index.html", true, APP_ORIGIN)).toBe(false); // credentials
    expect(isTrustedFrame("http://asgard/index.html", true, APP_ORIGIN)).toBe(false); // scheme
    expect(isTrustedFrame("file:///index.html", true, APP_ORIGIN)).toBe(false);
    expect(isTrustedFrame(undefined, true, APP_ORIGIN)).toBe(false);
    expect(isTrustedFrame("not a url", true, APP_ORIGIN)).toBe(false);
  });
});

describe("IPC result envelope (serializable across the bridge)", () => {
  it("wraps success and failure", () => {
    expect(ipcOk({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
    const err = ipcFail("boom", 503, "backend_unavailable");
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.error).toEqual({ message: "boom", status: 503, code: "backend_unavailable" });
    }
  });

  it("sanitizes and bounds error messages (no control chars, no unbounded body)", () => {
    expect(sanitizeMessage("a\u0000b\nc")).toBe("a b c");
    expect(sanitizeMessage("x".repeat(9000)).length).toBe(500);
    expect(sanitizeMessage("")).toBe("An unexpected error occurred.");
  });
});

it("exposes the minimal channel set", () => {
  expect(Object.values(IPC).sort()).toEqual(
    [
      "asgard:handshake",
      "asgard:request",
      "asgard:selectFolder",
      "asgard:retryBackend",
      "asgard:backendUnavailable",
      "asgard:backendSubscribe",
    ].sort()
  );
});
