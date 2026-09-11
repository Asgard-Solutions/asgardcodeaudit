// Real Chromium preview against the real Python backend and generated preview
// assets. The local ingress is a test-owned same-origin reverse proxy, not the
// hosted Emergent ingress. No Electron preload or desktop filesystem API exists.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard-preview-'));
const output = path.resolve(__dirname, '../../test_reports/preview-browser');
const dist = path.resolve(__dirname, '../../frontend/dist-preview');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(root, 'browser'));
let backend, server, win, done = false;
const requests = [], logs = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => finish(new Error('Preview browser test exceeded 60 seconds.')), 60000);
async function finish(error) {
  if (done) return;
  done = true;
  clearTimeout(deadline);
  try {
    if (win && !win.isDestroyed()) {
      fs.writeFileSync(path.join(output, 'preview.png'), (await win.capturePage()).toPNG());
      logs.push(await win.webContents.executeJavaScript('document.body.innerText').catch(() => ''));
    }
  } catch {}
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: !error, error: error ? String(error) : null, requests, logs, electron: process.versions.electron }, null, 2));
  if (error) console.error(error); else console.log('REAL_PREVIEW_BROWSER_PASSED');
  if (backend && backend.exitCode === null) {
    backend.kill();
    await Promise.race([new Promise(r => backend.once('exit', r)), delay(3000)]);
  }
  if (server) server.close();
  app.exit(error ? 1 : 0);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
async function port() {
  const socket = http.createServer();
  await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const value = socket.address().port;
  await new Promise(r => socket.close(r));
  return value;
}
async function waitFor(fn, label) {
  for (let i = 0; i < 150; i++) {
    if (await fn().catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
app.whenReady().then(async () => {
  const apiPort = await port();
  const python = process.env.ASGARD_PYTHON || path.resolve(__dirname, '../../backend/.venv/Scripts/python.exe');
  backend = spawn(python, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', String(apiPort)], {
    cwd: path.resolve(__dirname, '../../backend'),
    env: { ...process.env, ASGARD_MODE: 'preview', ASGARD_DATA_DIR: path.join(root, 'data'), ASGARD_PREVIEW_ORIGINS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  backend.once('error', finish);
  backend.stdout.on('data', b => logs.push(b.toString()));
  backend.stderr.on('data', b => logs.push(b.toString()));
  await waitFor(async () => (await fetch(`http://127.0.0.1:${apiPort}/api/v1/startup/handshake`)).ok, 'Python readiness');
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      requests.push({ method: req.method, path: req.url, host: req.headers.host, origin: req.headers.origin || null });
      const upstream = http.request({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: req.headers }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
      return;
    }
    let requested;
    try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    const rel = requested === '/' || !path.extname(requested) ? 'index.html' : requested.replace(/^\/+/, '');
    const file = path.resolve(dist, rel);
    if (!file.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    try { res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, level, message) => logs.push({ level, message }));
  await win.loadURL(origin);
  const js = code => win.webContents.executeJavaScript(code, true);
  await waitFor(() => js('!!document.querySelector(\'[data-testid="backend-ready"]\')'), 'real preview boot');
  assert.equal(await js('typeof window.asgard'), 'undefined');
  assert.match(await js('document.querySelector(\'[data-testid="mode-badge"]\').textContent'), /preview/i);
  await js('document.querySelector(\'[data-testid="nav-projects"]\').click()');
  await waitFor(() => js('!!document.querySelector(\'[data-testid="register-project-btn"]\')'), 'Projects');
  await js('document.querySelector(\'[data-testid="register-project-btn"]\').click()');
  await waitFor(() => js('!!document.querySelector(\'[data-testid="fixture-option-py-fastapi-sample"]\')'), 'approved fixture');
  await js(`(() => { const input = document.querySelector('[data-testid="register-name-input"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Preview Browser Fixture'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-testid="fixture-option-py-fastapi-sample"]').click(); })()`);
  await delay(100);
  await js('document.querySelector(\'[data-testid="register-submit"]\').click()');
  await waitFor(() => js('document.body.innerText.includes("Preview Browser Fixture") && !document.querySelector(\'[data-testid="register-submit"]\')'), 'fixture registration');
  assert.ok(requests.some(r => r.path === '/api/v1/dev/session' && r.method === 'POST'));
  assert.ok(requests.some(r => r.path === '/api/v1/projects' && r.method === 'POST'));
  assert.ok(requests.every(r => r.host === new URL(origin).host));
  await finish();
}).catch(finish);
