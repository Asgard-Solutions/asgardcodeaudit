/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly REACT_APP_BACKEND_URL?: string;
  readonly VITE_ASGARD_MODE?: "preview" | "desktop";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AsgardBridge {
  request: (method: string, path: string, body?: unknown) => Promise<unknown>;
  handshake: () => Promise<unknown>;
  selectFolder: () => Promise<unknown>;
  retryBackend: () => Promise<unknown>;
  onBackendUnavailable: (
    callback: (status: { reason: string; message: string }) => void
  ) => () => void;
}

interface Window {
  asgard?: AsgardBridge;
}
