import type { Mode, Transport } from "./contract";
import { ApiError } from "./contract";

// Explicit, build-time mode selection. The desktop build is compiled with
// VITE_ASGARD_MODE=desktop; the preview harness defaults to "preview". There is
// NO silent fallback: a desktop build without the preload bridge produces a
// useful startup error, and an invalid mode value is rejected outright. Each
// adapter is loaded via dynamic import so the unused transport is excluded from
// the production bundle for the selected mode.

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
  const mode = resolveMode();
  if (mode === "desktop") {
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
