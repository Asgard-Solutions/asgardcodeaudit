import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveAssetPath, mimeFor, isApprovedAuthority, APP_LAUNCH_URL, APP_ORIGIN } from "./protocol";

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

describe("app:// authority guard (protocol handler)", () => {
  it("launch url resolves to the '/' Overview route within the approved origin", () => {
    expect(APP_LAUNCH_URL).toBe(`${APP_ORIGIN}/`);
    expect(new URL(APP_LAUNCH_URL).pathname).toBe("/");
  });

  it("accepts only the exact approved scheme + host, no port, no credentials", () => {
    expect(isApprovedAuthority(`${APP_ORIGIN}/`)).toBe(true);
    expect(isApprovedAuthority(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(isApprovedAuthority(`${APP_ORIGIN}/assets/x.js`)).toBe(true);
    expect(isApprovedAuthority("app://evil/index.html")).toBe(false);
    expect(isApprovedAuthority("app://asgard:9000/index.html")).toBe(false);
    expect(isApprovedAuthority("app://user:pass@asgard/index.html")).toBe(false);
    expect(isApprovedAuthority("http://asgard/index.html")).toBe(false);
    expect(isApprovedAuthority("file:///etc/passwd")).toBe(false);
  });
});
