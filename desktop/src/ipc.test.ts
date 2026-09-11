import { describe, it, expect } from "vitest";
import { validateApiRequest, ALLOWED_METHODS, ALLOWED_PATH_RE, IPC } from "./ipc";

describe("IPC request allow-list (bridge validation)", () => {
  it("accepts allowed method + versioned path", () => {
    expect(validateApiRequest("get", "/api/v1/projects")).toEqual({
      method: "GET",
      path: "/api/v1/projects",
    });
    expect(validateApiRequest("POST", "/api/v1/projects").method).toBe("POST");
    expect(validateApiRequest("DELETE", "/api/v1/projects/abc123").path).toBe(
      "/api/v1/projects/abc123"
    );
  });

  it("rejects methods that are not allow-listed", () => {
    expect(() => validateApiRequest("PUT", "/api/v1/projects")).toThrow();
    expect(() => validateApiRequest("OPTIONS", "/api/v1/projects")).toThrow();
    expect(() => validateApiRequest(123, "/api/v1/projects")).toThrow();
  });

  it("rejects paths outside /api/v1", () => {
    expect(() => validateApiRequest("GET", "/etc/passwd")).toThrow();
    expect(() => validateApiRequest("GET", "/api/v2/projects")).toThrow();
    expect(() => validateApiRequest("GET", "http://evil.example/api/v1/x")).toThrow();
    expect(() => validateApiRequest("GET", 42)).toThrow();
  });

  it("rejects path traversal attempts", () => {
    expect(() => validateApiRequest("GET", "/api/v1/../../secret")).toThrow();
  });

  it("exposes a stable, minimal channel set", () => {
    expect(Object.values(IPC).sort()).toEqual(
      ["asgard:handshake", "asgard:request", "asgard:selectFolder"].sort()
    );
    expect([...ALLOWED_METHODS].sort()).toEqual(["DELETE", "GET", "PATCH", "POST"]);
    expect(ALLOWED_PATH_RE.test("/api/v1/preview/fixtures")).toBe(true);
  });
});
