import { BrowserWindow, session } from "electron";

export function secureWebPreferences(preloadPath: string) {
  return {
    preload: preloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
  };
}

// Documents are served from the app:// origin, so 'self' scopes to the packaged
// app. The renderer talks to the backend only through IPC, so no loopback HTTP
// origin is granted to the page.
export function applyContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

export function lockDownNavigation(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.on("will-redirect", (event) => event.preventDefault());
}
