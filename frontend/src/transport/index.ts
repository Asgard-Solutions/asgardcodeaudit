import type { Mode, Transport } from "./contract";
import { ApiError } from "./contract";

// The branch expression must reference the build-time value directly. Returning
// the mode through a helper can leave both dynamic imports in emitted output.
// npm's postbuild gate checks the actual desktop files, not just this source.
export class ConfigError extends Error {}

let _transport: Transport | null = null;

function resolveMode(): Mode {
  const raw = (import.meta.env.VITE_ASGARD_MODE ?? "preview") as string;
  if (raw !== "preview" && raw !== "desktop") {
    throw new ConfigError(
      `Invalid ASGARD mode "${raw}". Expected "preview" or "desktop".`
    );
  }
  return raw;
}

function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && !!window.asgard;
}

export async function createTransport(): Promise<Transport> {
  resolveMode(); // Invalid configuration must still fail instead of falling back.
  if (import.meta.env.VITE_ASGARD_MODE === "desktop") {
    if (!hasDesktopBridge()) {
      throw new ApiError(
        0,
        "Desktop bridge unavailable: the secure preload (window.asgard) did not load. " +
          "The app cannot fall back to preview mode."
      );
    }
    const { DesktopTransport } = await import("./desktop");
    _transport = new DesktopTransport();
  } else {
    const { PreviewTransport } = await import("./preview");
    _transport = new PreviewTransport();
  }
  return _transport;
}

export function getTransport(): Transport {
  if (!_transport) throw new Error("Transport not initialized. Call createTransport() first.");
  return _transport;
}

export * from "./contract";
