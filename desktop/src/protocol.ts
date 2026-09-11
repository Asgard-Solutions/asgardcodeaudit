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
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
