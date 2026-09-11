const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
if (process.platform !== 'win32') throw new Error('Native smoke requires Windows.');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asgard-phase1-'));
const source = path.join(root, 'Source Folder With Spaces');
fs.mkdirSync(source);
const file = path.join(source, 'README.md');
fs.writeFileSync(file, 'Synthetic source fixture. The auditor must not change this file.\n');
const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const original = hash();
const destination = path.resolve(__dirname, '../../test_reports/native-windows');
fs.mkdirSync(destination, { recursive: true });
const env = {
  ...process.env,
  ASGARD_NATIVE_TEST_ROOT: root,
  ASGARD_BACKEND_DIR: path.resolve(__dirname, '../../backend'),
  ASGARD_RENDERER_DIST: path.resolve(__dirname, '../../frontend/dist'),
  ASGARD_PYTHON: path.resolve(__dirname, '../../backend/.venv/Scripts/python.exe'),
};
delete env.ELECTRON_RUN_AS_NODE;
async function session(phase) {
  const child = spawn(require('electron'), [path.join(__dirname, 'native-session.cjs')], {
    env: { ...env, ASGARD_NATIVE_TEST_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { log += b.toString(); process.stdout.write(b); });
  const timer = setTimeout(() => {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); } catch {}
  }, 120000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Native ${phase} exited ${code}`)));
    });
    const report = JSON.parse(fs.readFileSync(path.join(root, 'evidence', `${phase}.json`), 'utf8'));
    assert.equal(report.passed, true);
    assert.equal(hash(), original, 'The synthetic source file changed.');
  } finally {
    clearTimeout(timer);
    fs.writeFileSync(path.join(destination, `${phase}.log`), log);
    const evidence = path.join(root, 'evidence');
    if (fs.existsSync(evidence)) fs.cpSync(evidence, destination, { recursive: true });
  }
}
(async () => {
  try {
    await session('create');
    await session('restart');
    fs.writeFileSync(path.join(destination, 'summary.json'), JSON.stringify({
      passed: true, platform: process.platform, node: process.version,
      sourceSha256Before: original, sourceSha256After: hash(),
      scope: 'Actual Electron main/preload/renderer, actual Python backend, actual Windows folder dialog, restart, recovery, and isolated source nonmutation. Not an installer test.',
    }, null, 2));
    console.log('NATIVE_WINDOWS_FOUNDATION_PASSED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
