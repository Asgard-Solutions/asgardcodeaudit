// Runs inside the actual Electron binary, against the actual main/preload and
// Python backend. Only synthetic fixture paths are used. No Electron mocks.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = process.env.ASGARD_NATIVE_TEST_ROOT;
if (!root || process.platform !== 'win32') throw new Error('This smoke test requires Windows and an isolated fixture root.');
const phase = process.env.ASGARD_NATIVE_TEST_PHASE || 'create';
const secondary = process.env.ASGARD_NATIVE_SECONDARY === '1';
const source = path.join(root, 'Source Folder With Spaces');
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', path.join(root, 'app-data'));
let window, completed = false;
const observations = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timer = setTimeout(() => fail(new Error('Native test exceeded 100 seconds.')), 100000);
app.on('will-quit', () => { clearTimeout(timer); if (!secondary && !completed) process.exitCode = 1; });
async function fail(error) {
  if (completed) return;
  completed = true;
  console.error('NATIVE_SMOKE_FAILED', error && error.stack || error);
  try {
    if (window && !window.isDestroyed()) {
      const image = await window.capturePage();
      fs.writeFileSync(path.join(evidence, `${phase}-failure.png`), image.toPNG());
      observations.push({ body: await window.webContents.executeJavaScript('document.body.innerText').catch(() => '') });
    }
  } catch {}
  fs.writeFileSync(path.join(evidence, `${phase}.json`), JSON.stringify({ passed: false, error: String(error), observations }, null, 2));
  process.exitCode = 1;
  app.quit();
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
async function js(code) { return window.webContents.executeJavaScript(code, true); }
async function until(code, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await js(code).catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const exists = id => `!!document.querySelector('[data-testid="${id}"]')`;
const click = id => js(`document.querySelector('[data-testid="${id}"]').click()`);
async function nativeDialog(mode) {
  return exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'native-dialog.ps1'), '-OwnerPid', String(process.pid), '-Mode', mode, '-Folder', source], { timeout: 20000 });
}
async function run() {
  await until(exists('backend-ready'), 'actual renderer boot');
  assert.equal(window.webContents.getURL(), 'app://asgard/');
  const prefs = window.webContents.getLastWebPreferences();
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(await js('typeof require'), 'undefined');
  const hs = await js('window.asgard.handshake()');
  assert.equal(hs.ok, true);
  assert.equal(hs.data.mode, 'desktop');
  observations.push({ nativeLaunch: true, identity: hs.data, electron: process.versions.electron });

  const denied = await js('window.asgard.request("DELETE", "/api/v1/not-approved")');
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'ipc_validation');
  observations.push({ unapprovedOperationRejected: true });

  await click('nav-projects');
  await until('location.pathname === "/projects"', 'Projects route');
  if (phase === 'create') {
    // Native cancellation through the real preload and OS dialog.
    const cancellation = js('window.asgard.selectFolder()');
    const cancelAutomation = await nativeDialog('cancel');
    const cancelled = await cancellation;
    assert.deepEqual(cancelled, { ok: true, data: null });
    observations.push({ nativeCancel: true, automation: cancelAutomation.stdout.trim() });

    await click('register-project-btn');
    await until(exists('register-name-input'), 'registration modal');
    await js(`(() => { const e = document.querySelector('[data-testid="register-name-input"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'Phase 1 Native Smoke'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('pick-folder-btn');
    const selection = await nativeDialog('select');
    await until(`document.querySelector('[data-testid="picked-path"]')?.textContent === ${JSON.stringify(source)}`, 'native selected path');
    await click('register-submit');
    await until('document.body.innerText.includes("Phase 1 Native Smoke") && !document.querySelector(\'[data-testid="register-submit"]\')', 'registered project');
    observations.push({ nativeSelectionAndRegistration: true, automation: selection.stdout.trim() });
  }

  const listed = await js('window.asgard.request("GET", "/api/v1/projects")');
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].name, 'Phase 1 Native Smoke');
  const id = listed.data[0].id;
  observations.push({ persistedProject: id, phase });
  const duplicate = await js(`window.asgard.request('POST', '/api/v1/projects', ${JSON.stringify({ name: 'Duplicate', path: source })})`);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.status, 409);
  assert.equal(duplicate.error.code, 'duplicate_root');

  // History navigation and reload retain the real sender/frame permissions.
  await js(`(() => { history.pushState({}, '', '/projects/${id}/settings'); dispatchEvent(new PopStateEvent('popstate')); })()`);
  assert.equal((await js(`window.asgard.request('GET', '/api/v1/projects/${id}')`)).ok, true);
  await click('nav-diagnostics');
  await until('location.pathname === "/diagnostics"', 'Diagnostics route');
  assert.equal((await js('window.asgard.request("GET", "/api/v1/diagnostics")')).ok, true);
  await js('history.back()');
  await until('location.pathname.includes("/settings")', 'history back');
  await js('history.forward()');
  await until('location.pathname === "/diagnostics"', 'history forward');
  const reload = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reload;
  await until(exists('backend-ready'), 'renderer reload');
  observations.push({ routingAndReload: true });

  if (phase === 'create') {
    let secondSeen = false;
    app.once('second-instance', () => { secondSeen = true; });
    const second = spawn(process.execPath, [__filename], { env: { ...process.env, ASGARD_NATIVE_SECONDARY: '1' }, stdio: 'ignore' });
    await new Promise((resolve, reject) => { second.once('error', reject); second.once('exit', code => code === 0 ? resolve() : reject(new Error(`Second instance exit ${code}`))); });
    assert.equal(secondSeen, true);
    observations.push({ nativeSingleInstance: true });

    // Kill only the Python process started by this isolated Electron instance.
    const command = `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${process.pid} -and $_.Name -match '^python' } | Select-Object -ExpandProperty ProcessId`;
    const found = await exec('powershell.exe', ['-NoProfile', '-Command', command], { timeout: 10000 });
    const pids = found.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
    assert.equal(pids.length, 1, 'Expected exactly one owned Python backend');
    process.kill(pids[0]);
    await until(exists('backend-unavailable'), 'post-readiness crash notification');
    await click('backend-retry');
    await until(exists('backend-ready'), 'authenticated recovery', 20000);
    assert.equal((await js('window.asgard.request("GET", "/api/v1/projects")')).data.length, 1);
    observations.push({ actualBackendCrashRecovery: true });
  } else {
    const removed = await js(`window.asgard.request('DELETE', '/api/v1/projects/${id}')`);
    assert.equal(removed.ok, true);
    assert.equal((await js('window.asgard.request("GET", "/api/v1/projects")')).data.length, 0);
    observations.push({ removeRegistration: true });
  }
  const image = await window.capturePage();
  fs.writeFileSync(path.join(evidence, `${phase}-native.png`), image.toPNG());
  completed = true;
  fs.writeFileSync(path.join(evidence, `${phase}.json`), JSON.stringify({ passed: true, observations }, null, 2));
  console.log('NATIVE_SMOKE_PASSED', phase, JSON.stringify(observations));
  app.quit(); // actual production before-quit path must finish its backend cleanup
}
if (!secondary) {
  app.once('browser-window-created', (_event, win) => {
    window = win;
    win.webContents.on('console-message', (_event, level, message) => observations.push({ level, message }));
    win.webContents.once('did-finish-load', () => void run().catch(fail));
  });
}
require('../dist/main.js');
