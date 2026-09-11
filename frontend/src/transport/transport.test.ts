import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTransport, ConfigError } from "./index";
import { ApiError } from "./contract";

describe("transport mode selection (explicit, no silent fallback)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    (window as unknown as { asgard?: unknown }).asgard = undefined;
  });

  it("preview mode creates the preview transport", async () => {
    vi.stubEnv("VITE_ASGARD_MODE", "preview");
    const t = await createTransport();
    expect(t.mode).toBe("preview");
  });

  it("rejects an invalid mode instead of defaulting", async () => {
    vi.stubEnv("VITE_ASGARD_MODE", "bogus");
    await expect(createTransport()).rejects.toBeInstanceOf(ConfigError);
  });

  it("desktop build without the bridge errors — never falls back to preview", async () => {
    vi.stubEnv("VITE_ASGARD_MODE", "desktop");
    await expect(createTransport()).rejects.toBeInstanceOf(ApiError);
  });

  it("desktop build with a bridge uses the desktop transport", async () => {
    vi.stubEnv("VITE_ASGARD_MODE", "desktop");
    (window as unknown as { asgard?: unknown }).asgard = {
      request: vi.fn(),
      handshake: vi.fn(),
      selectFolder: vi.fn(),
    };
    const t = await createTransport();
    expect(t.mode).toBe("desktop");
  });
});
