import { describe, it, expect } from "vitest";
import {
  resolveOperation,
  validateBody,
  validateApiRequest,
  isTrustedFrame,
  IpcValidationError,
  IPC,
} from "./ipc";
import { APP_INDEX_URL } from "./protocol";

describe("IPC operation allow-list (not a prefix filter)", () => {
  it("accepts exactly the approved operations", () => {
    expect(resolveOperation("GET", "/api/v1/projects").name).toBe("listProjects");
    expect(resolveOperation("post", "/api/v1/projects").name).toBe("createProject");
    expect(resolveOperation("DELETE", "/api/v1/projects/" + "a".repeat(32)).name).toBe("removeProject");
    expect(resolveOperation("GET", "/api/v1/diagnostics").name).toBe("diagnostics");
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

describe("IPC sender-frame trust (scheme alone is insufficient)", () => {
  it("accepts only the exact main app frame URL", () => {
    expect(isTrustedFrame(APP_INDEX_URL, true, APP_INDEX_URL)).toBe(true);
  });
  it("rejects sub-frames, wrong URLs, and scheme-only matches", () => {
    expect(isTrustedFrame(APP_INDEX_URL, false, APP_INDEX_URL)).toBe(false); // not main frame
    expect(isTrustedFrame("app://asgard/evil.html", true, APP_INDEX_URL)).toBe(false);
    expect(isTrustedFrame("app://evil/index.html", true, APP_INDEX_URL)).toBe(false);
    expect(isTrustedFrame(undefined, true, APP_INDEX_URL)).toBe(false);
  });
});

it("exposes a minimal channel set", () => {
  expect(Object.values(IPC).sort()).toEqual(
    ["asgard:handshake", "asgard:request", "asgard:selectFolder"].sort()
  );
});
