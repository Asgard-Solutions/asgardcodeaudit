// Minimal fake backend used by desktop lifecycle tests (a REAL child process).
// Parses --host/--port, reads the per-launch secret from stdin, and serves the
// readiness identity + an authenticated /build probe.
import http from "node:http";

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const host = arg("--host") ?? "127.0.0.1";
const port = Number(arg("--port") ?? "0");
const mode = process.env.FAKE_MODE ?? "ok"; // ok | wrongid | exit

if (mode === "exit") process.exit(3);

let secret = "";
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString("utf8");
  const nl = buf.indexOf("\n");
  if (nl >= 0) {
    try {
      secret = JSON.parse(buf.slice(0, nl)).session_secret ?? "";
    } catch {
      /* ignore */
    }
  }
});

const server = http.createServer((req, res) => {
  if (req.url === "/api/v1/startup/handshake") {
    const body =
      mode === "wrongid"
        ? { status: "ready", name: "Some Other Server", mode: "preview" }
        : { status: "ready", name: "Asgard CodeAudit", mode: "desktop" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  if (req.url === "/api/v1/build") {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${secret}`) {
      res.writeHead(401);
      res.end("{}");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name: "Asgard CodeAudit", version: "test" }));
    return;
  }
  res.writeHead(404);
  res.end("{}");
});
server.listen(port, host);
