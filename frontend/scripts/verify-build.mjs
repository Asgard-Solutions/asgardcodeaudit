import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs as npm's postbuild hook, so forwarded Vite --outDir arguments still
// belong to the build command. Only the desktop distribution has this gate.
const mode = process.env.VITE_ASGARD_MODE ?? "preview";
if (mode !== "preview" && mode !== "desktop") {
  throw new Error(`Invalid VITE_ASGARD_MODE: ${mode}`);
}
if (mode === "desktop") {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const scripts = [];
  async function collect(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await collect(file);
      else if (/\.(?:m?js|cjs)$/.test(item.name)) scripts.push(file);
    }
  }
  await collect(dist);
  if (scripts.length === 0) throw new Error("Desktop build contains no emitted JavaScript.");
  for (const file of scripts) {
    const content = await readFile(file, "utf8");
    if (/^preview-[^/]+\.js$/.test(path.basename(file))
        || content.includes("/api/v1/dev/session")
        || content.includes("PreviewTransport")) {
      throw new Error(`Desktop build includes the development preview transport: ${path.relative(dist, file)}`);
    }
  }
  console.log(`DESKTOP_BUILD_ISOLATION_PASSED: ${scripts.length} emitted scripts; no preview adapter or dev-session endpoint.`);
} else {
  console.log("Preview build: desktop isolation gate is not applicable.");
}
