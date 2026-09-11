import { build } from "esbuild";

// Bundle main + preload into self-contained CommonJS artifacts. The preload
// must not depend on a local runtime require("./ipc") (a sandboxed preload
// cannot resolve local modules), so everything except 'electron' is inlined.
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.js" });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" });
console.log("bundled dist/main.js and dist/preload.js");
