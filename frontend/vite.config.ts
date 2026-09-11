import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Preview harness runs behind the platform ingress on port 3000; HMR is proxied
// over wss/443. `REACT_APP_BACKEND_URL` (a protected env var) is exposed to the
// client so the preview transport can reach the backend through the ingress.
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "REACT_APP_"],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: "wss" },
  },
});
