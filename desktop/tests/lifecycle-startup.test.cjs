// Node's test runner executes the actual TypeScript controller. Only window and
// child-process interfaces are substituted; this is not native Electron proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/lifecycle.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { Lifecycle } = loaded.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(overrides = {}) {
  const events = [];
  const child = { stop: async () => events.push('child-stopped'), recentLogs: () => '', onExit: () => {} };
  const deps = {
    createWindow: () => events.push('window-created'),
    destroyWindow: () => events.push('window-destroyed'),
    startBackend: async () => { events.push('child-started'); return child; },
    loadAppAndShow: async () => events.push('window-loaded'),
    fetchHandshake: async () => ({ status: 'ready', name: 'Asgard CodeAudit', version: 'test', mode: 'desktop', source_revision: null }),
    showStartupErrorDialog: async () => { events.push('dialog'); return false; },
    notifyUnavailable: () => events.push('unavailable'),
    quit: () => events.push('quit'),
    ...overrides,
  };
  return { controller: new Lifecycle(deps), events, child };
}

test('back-to-back boot and shutdown create no window or child', async () => {
  const { controller, events } = harness();
  const boot = controller.boot();
  const stop = controller.shutdown();
  await Promise.all([boot, stop]);
  assert.equal(controller.getState(), 'stopped');
  assert.deepEqual(events, []);
});

test('boot after completed shutdown leaves the terminal state unchanged', async () => {
  const { controller, events } = harness();
  await controller.shutdown();
  await controller.boot();
  assert.equal(controller.getState(), 'stopped');
  assert.deepEqual(events, []);
});

test('concurrent boot calls share one launch and one cleanup owner', async () => {
  const gate = deferred();
  let starts = 0;
  const { controller, child, events } = harness({ startBackend: async () => { starts++; return gate.promise; } });
  const first = controller.boot();
  const second = controller.boot();
  await tick();
  gate.resolve(child);
  await Promise.all([first, second]);
  const observed = { samePromise: first === second, starts, windows: events.filter(e => e === 'window-created').length };
  await controller.shutdown();
  assert.deepEqual(observed, { samePromise: true, starts: 1, windows: 1 });
});

test('a boot call on a ready session does not replace its live backend', async () => {
  const { controller, events } = harness();
  await controller.boot();
  const before = events.slice();
  await controller.boot();
  const after = events.slice();
  await controller.shutdown();
  assert.deepEqual(after, before);
});

test('shutdown from a window callback stops startup before the child is created', async () => {
  let controller, starts = 0, shutdown;
  const h = harness({
    createWindow: () => { shutdown = controller.shutdown(); },
    startBackend: async () => { starts++; return h.child; },
  });
  controller = h.controller;
  await controller.boot();
  await shutdown;
  assert.equal(starts, 0);
  assert.equal(controller.getState(), 'stopped');
});

test('shutdown during cleanup cannot create the next retry window', async () => {
  const stopEntered = deferred(), releaseStop = deferred();
  let windows = 0, starts = 0;
  const { controller } = harness({
    createWindow: () => { windows++; },
    startBackend: async () => {
      starts++;
      return { onExit: () => {}, recentLogs: () => '', stop: async () => { stopEntered.resolve(); await releaseStop.promise; } };
    },
    loadAppAndShow: async () => { throw new Error('synthetic renderer load failure'); },
    showStartupErrorDialog: async () => true,
  });
  const boot = controller.boot();
  await stopEntered.promise;
  const stopping = controller.shutdown();
  releaseStop.resolve();
  await Promise.all([boot, stopping]);
  assert.equal(starts, 1);
  assert.equal(windows, 1);
  assert.equal(controller.getState(), 'stopped');
});
