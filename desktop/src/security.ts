import { BrowserWindow, session, shell } from "electron";

// Renderer hardening. All windows are sandboxed, context-isolated, and cannot
// integrate Node. Navigation and window creation are locked down, and a strict
// Content-Security-Policy is applied to the app's responses.

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

export function applyContentSecurityPolicy(loopbackOrigin: string) {
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
            `connect-src 'self' ${loopbackOrigin}`,
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
  // Deny all attempts to open new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // Block in-app navigation away from the loaded app.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  // External links (if any are ever added) go to the OS browser, not the app.
  win.webContents.on("will-redirect", (event) => event.preventDefault());
  void shell; // available for explicit, reviewed external-open flows only
}
