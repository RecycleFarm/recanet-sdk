// Deterministic mocks only. Optional baseline directory must contain compiled dist + test helpers.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] ?? '.');
const sdk = await import(pathToFileURL(resolve(root, 'dist/index.js')));
const { userActivityFixture } = await import(pathToFileURL(resolve(root, 'tests/helpers/user-activity.mjs')));
const run = sdk.withDiagnosticOperation ?? ((_name, _id, action) => action());
const results = [];
for (const mode of sdk.configureDiagnostics ? ['disabled', 'default', 'detailed'] : ['baseline']) {
  const logs = [], original = console.log;
  console.log = text => logs.push(String(text));
  sdk.configureDiagnostics?.({ enabled: mode !== 'disabled', detailedLogging: mode === 'detailed', localSink: text => logs.push(text) });
  try {
    let rpcCalls = 0;
    const asset = new sdk.AssetClient(new sdk.HttpEvmRpc('http://localhost:9999', { fetch: async (_url, init) => {
      rpcCalls++; const { id, method } = JSON.parse(init.body);
      return Response.json({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0x66eee' : '0xa' });
    } }));
    await run('balance-batch', 'volume:read', async () => { for (let i = 0; i < 20; i++) await asset.getBalance('0x' + '12'.repeat(20)); });
    results.push({ mode, scenario: '20 balance reads in one operation', logs: logs.length, bytes: logs.reduce((sum, line) => sum + Buffer.byteLength(line + '\n'), 0), rpcCalls });
    logs.length = 0;
    const f = userActivityFixture(true, { petV3: true });
    let dmrvnRpcCalls = 0; const call = f.rpc.call.bind(f.rpc); f.rpc.call = (...args) => { dmrvnRpcCalls++; return call(...args); };
    const request = new sdk.ActivityRequest('member', 'source', { petBottleCount: 3 }, { gas: '100000', confirmationTimeoutMs: 100, pollIntervalMs: 1 });
    const outcome = await run('activity', 'volume:dmrvn', () => f.client.submitActivity(f.wallets, request));
    results.push({ mode, scenario: 'DMRVN confirmed workflow', logs: logs.length, bytes: logs.reduce((sum, line) => sum + Buffer.byteLength(line + '\n'), 0), rpcCalls: dmrvnRpcCalls, creates: f.counts.creates, uploads: f.counts.uploads, sends: f.facts.sends, outcome: outcome.outcome });
  } finally { console.log = original; sdk.configureDiagnostics?.(); }
}
console.log(JSON.stringify(results, null, 2));
