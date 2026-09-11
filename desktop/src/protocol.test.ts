import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveAssetPath, mimeFor } from "./protocol";

const dist = "/app/frontend/dist";

describe("app:// asset resolver", () => {
  it("serves index.html for root and SPA routes", () => {
    expect(resolveAssetPath(dist, "/")).toBe(path.join(dist, "index.html"));
    expect(resolveAssetPath(dist, "/projects")).toBe(path.join(dist, "index.html"));
    expect(resolveAssetPath(dist, "/projects/abc/settings")).toBe(path.join(dist, "index.html"));
  });

  it("resolves real asset files under dist", () => {
    expect(resolveAssetPath(dist, "/assets/index-abc.js")).toBe(path.join(dist, "assets/index-abc.js"));
  });

  it("rejects traversal / escapes", () => {
    expect(resolveAssetPath(dist, "/../secret.js")).toBeNull();
    expect(resolveAssetPath(dist, "/../../etc/passwd")).toBeNull();
    expect(resolveAssetPath(dist, "/assets/../../secret.css")).toBeNull();
  });

  it("maps mime types", () => {
    expect(mimeFor("/x/app.js")).toContain("javascript");
    expect(mimeFor("/x/app.css")).toContain("css");
    expect(mimeFor("/x/index.html")).toContain("html");
  });
});
