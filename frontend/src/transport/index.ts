import type { Transport } from "./contract";
import { PreviewTransport } from "./preview";
import { DesktopTransport, hasDesktopBridge } from "./desktop";

let _transport: Transport | null = null;

export function getTransport(): Transport {
  if (_transport) return _transport;
  _transport = hasDesktopBridge() ? new DesktopTransport() : new PreviewTransport();
  return _transport;
}

export * from "./contract";
