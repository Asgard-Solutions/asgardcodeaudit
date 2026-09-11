// Actual preview adapter/contract, with the build-time environment substitution
// and fetch boundary controlled. This is transport coverage, not browser proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(name) {
  const filename = path.join(__dirname, '../src/transport', name + '.ts');
  let text = fs.readFileSync(filename, 'utf8');
  text = text.replaceAll('import.meta.env.REACT_APP_BACKEND_URL', JSON.stringify('https://different-preview.example'));
  const compiled = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = module.paths;
  const baseRequire = m.require.bind(m);
  m.require = p => p === './contract' ? contract : baseRequire(p);
  m._compile(compiled, filename);
  return m.exports;
}
let contract;
contract = load('contract');
const { PreviewTransport } = load('preview');
const identity = { status: 'ready', name: 'Asgard CodeAudit', version: 'test', source_revision: null, mode: 'preview' };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function mockFetch(t, fn) { const old = global.fetch; global.fetch = fn; t.after(() => { global.fetch = old; }); }

test('session and handshake use the browser origin, not another deployment hostname', async t => {
  const urls = [];
  mockFetch(t, async (url, init) => { urls.push(url); return response(url.endsWith('/dev/session') ? { token: 'synthetic-token', mode: 'preview' } : identity); });
  const adapter = new PreviewTransport();
  await adapter.init();
  await adapter.handshake();
  assert.deepEqual(urls, ['/api/v1/dev/session', '/api/v1/startup/handshake']);
});

test('a successful HTTP response without a session token is rejected', async t => {
  mockFetch(t, async () => response({ mode: 'preview' }));
  await assert.rejects(new PreviewTransport().init(), e => e instanceof contract.ApiError && e.code === 'malformed_response');
});

test('an unrelated successful handshake is not accepted as application readiness', async t => {
  mockFetch(t, async () => response({ ok: true }));
  await assert.rejects(new PreviewTransport().handshake(), e => e instanceof contract.ApiError && e.code === 'malformed_response');
});

test('request timeout covers a pending response body and produces a typed error', async t => {
  mockFetch(t, async (_url, init) => new Response(new ReadableStream({ start(stream) {
    init.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
  } })));
  const outcome = await Promise.race([
    new PreviewTransport({ timeoutMs: 25 }).handshake().then(() => 'accepted', e => e.code),
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 150)),
  ]);
  assert.equal(outcome, 'request_timeout');
});

test('non-JSON success is rejected with a useful typed response error', async t => {
  mockFetch(t, async () => new Response('<html>gateway login</html>', { status: 200 }));
  await assert.rejects(new PreviewTransport().handshake(), e => e instanceof contract.ApiError && e.code === 'malformed_response');
});

test('an ambiguous failed mutation is not automatically replayed', async t => {
  let posts = 0;
  mockFetch(t, async (url, init) => {
    if (url.endsWith('/dev/session')) return response({ token: 'synthetic-token', mode: 'preview' });
    posts++;
    throw new TypeError('network connection lost');
  });
  const adapter = new PreviewTransport();
  await assert.rejects(adapter.request('POST', '/api/v1/projects', { name: 'test' }));
  assert.equal(posts, 1);
});

test('an external API path is rejected before any request is dispatched', async t => {
  const urls = [];
  mockFetch(t, async url => { urls.push(url); return response({ token: 'synthetic-token', mode: 'preview' }); });
  const adapter = new PreviewTransport();
  await adapter.init();
  await assert.rejects(adapter.request('GET', 'https://other.example/private'), e => e instanceof contract.ApiError && e.code === 'invalid_api_path');
  assert.deepEqual(urls, ['/api/v1/dev/session']);
});
