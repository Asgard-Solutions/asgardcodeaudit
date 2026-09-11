import path from "node:path";

// Resolves an app:// request path to a real file inside the packaged renderer
// directory, or null if it escapes that directory (traversal / absolute paths).
// SPA routes (no file extension) fall back to index.html.
export function resolveAssetPath(distDir: string, requestPathname: string): string | null {
  const root = path.resolve(distDir);
  let rel = decodeURIComponent(requestPathname).replace(/^\/+/, "");
  if (rel === "") rel = "index.html";

  // Reject any traversal segment outright, before SPA fallback.
  if (rel.split(/[\\/]/).includes("..")) return null;

  // History-router fallback: a route without a file extension serves index.html.
  const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(rel);
  const candidate = path.resolve(root, looksLikeFile ? rel : "index.html");

  // Must stay within the packaged renderer directory.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export const APP_SCHEME = "app";
export const APP_HOST = "asgard";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
// Launch URL resolves to the "/" route (Overview). index.html is still served
// internally by the SPA fallback for this and every supported application route.
export const APP_LAUNCH_URL = `${APP_ORIGIN}/`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

// Authority check for the custom protocol handler: only the exact approved
// scheme + host, with no port and no embedded credentials, may be served.
export function isApprovedAuthority(requestUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  if (url.protocol !== `${APP_SCHEME}:`) return false;
  if (url.hostname !== APP_HOST) return false;
  if (url.port) return false;
  if (url.username || url.password) return false;
  return true;
}
