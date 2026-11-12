import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { trace } from '@opentelemetry/api';
import { AssetClient, EvmTransactionClient, HttpEvmRpc, PrivyClient, BackendWalletRegistration, ActivityRequest,
  configureDiagnostics, withDiagnosticOperation, sanitizeDiagnosticMessage, DmrvnError } from '../dist/index.js';
import { diagnosticOperation, diagnosticSubmission, diagnosticConfirmed, diagnosticState, diagnosticRestore } from '../dist/diagnostics.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';
import { userActivityFixture } from './helpers/user-activity.mjs';
import { diagnosticGreenfieldFixture } from './helpers/diagnostic-greenfield.mjs';

const address = '0x' + '12'.repeat(20), hash = '0x' + '34'.repeat(32);
function capture(options = {}) {
  const records = [];
  configureDiagnostics({ localSink: json => records.push(JSON.parse(json)), ...options });
  return records;
}
const events = (records, event) => records.filter(r => r.event === event);

test.afterEach(() => configureDiagnostics());

test('normal nested RPC reads emit exactly one compact root completion; disabled mode keeps call counts', async () => {
  let calls = 0;
  const rpc = new HttpEvmRpc('http://localhost:9999', { fetch: async (_url, init) => {
    calls++; const { id, method } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0x66eee' : '0xa' });
  } });
  const asset = new AssetClient(rpc), records = capture({ partnerId: 101, environment: 'test' });
  const read = () => withDiagnosticOperation('read-balance', 'read.1', async () => {
    for (let i = 0; i < 20; i++) assert.equal(await asset.getBalance(address), 10n);
  });
  await read(); assert.equal(calls, 40); assert.equal(records.length, 1);
  assert.deepEqual(records[0], { event: 'completed', operation_id: 'read.1', operation: 'read-balance', sdk_version: '0.1.0', partner_id: '101', environment: 'test' });
  configureDiagnostics({ enabled: false, localSink: () => assert.fail('disabled') }); await read(); assert.equal(calls, 80);
});

test('outer IDs win, invalid IDs use UUID, business idempotency values remain unchanged', async () => {
  const records = capture(); let key;
  const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
  const signer = { address, async sendTransaction(_chain, _tx, actual) { key = actual; return hash; } };
  await withDiagnosticOperation('outer', 'op:valid_1', () => asset.transfer(signer, address, 1n, 'business-key'));
  assert.equal(key, 'business-key'); assert.ok(records.every(r => r.operation_id === 'op:valid_1'));
  records.length = 0;
  await asset.transfer(signer, address, 1n, 'invalid business key'); assert.equal(key, 'invalid business key');
  assert.match(records[0].operation_id, /^[0-9a-f-]{36}$/);
  assert.ok(records.every(r => r.operation_id === records[0].operation_id));
});

test('propagated errors are logged once, identical independent errors and reused objects on retries survive', async () => {
  const records = capture(), same = new DmrvnError('RPC_UNAVAILABLE');
  await withDiagnosticOperation('retry', 'retry', async () => {
    for (let i = 0; i < 3; i++) await assert.rejects(() => diagnosticOperation('attempt', undefined, async () => {
      return diagnosticOperation('rpc', undefined, async () => { throw same; });
    }), error => error === same);
    for (let i = 0; i < 150; i++) await assert.rejects(() => diagnosticOperation('independent', undefined, async () => { throw new DmrvnError('RPC_UNAVAILABLE'); }));
  });
  assert.equal(events(records, 'failed').length, 153);
  assert.equal(events(records, 'failed').filter(r => r.failed_stage === 'rpc').length, 3);
});

test('submission starts before side effects, nesting is deduplicated and accepted differs from confirmed', async () => {
  const records = capture(); let sends = 0;
  await withDiagnosticOperation('send', 'send', async () => {
    await diagnosticSubmission('chain.send', () => diagnosticOperation('signer', 'child-key', () =>
      diagnosticSubmission('transport', async () => {
        assert.equal(records.at(-1).event, 'submission_started'); sends++; return hash;
      }, () => true)), value => value === hash);
    diagnosticConfirmed(); diagnosticConfirmed();
  });
  assert.equal(sends, 1);
  assert.deepEqual(records.map(r => r.event), ['submission_started', 'submission_accepted', 'submission_confirmed', 'completed']);
  assert.equal(records[1].submission_state, 'ACCEPTED'); assert.equal(records[2].submission_state, 'CONFIRMED');
  assert.ok(records.every(r => r.operation_id === 'send'));
});

test('parallel requests retain their own unknown/accepted states, target, sequence and independent IDs', async () => {
  const records = capture();
  await Promise.all(['one', 'two'].map(id => withDiagnosticOperation('parallel', id, async () => {
    await Promise.allSettled([
      diagnosticOperation('upload', undefined, () => diagnosticSubmission('upload', async () => {
        await new Promise(resolve => setTimeout(resolve, 10)); throw new DmrvnError('STORAGE_UNAVAILABLE');
      }, () => true)),
      diagnosticOperation('send', undefined, () => diagnosticSubmission('send', async () => hash, () => true)),
    ]);
  })));
  for (const id of ['one', 'two']) {
    const failed = records.find(r => r.operation_id === id && r.event === 'failed');
    assert.equal(failed.submission_target, 'upload'); assert.equal(failed.submission_state, 'OUTCOME_UNKNOWN');
    assert.equal(failed.submission_sequence, 1);
    const accepted = records.find(r => r.operation_id === id && r.event === 'submission_accepted');
    assert.equal(accepted.submission_target, 'send'); assert.equal(accepted.submission_sequence, 2);
  }
});

test('explicit broadcast facts are respected; timeout never means not broadcast', async () => {
  for (const [facts, state] of [[{}, 'OUTCOME_UNKNOWN'], [{ definitelyNotBroadcast: true }, 'NOT_BROADCAST'], [{ definitelyRejected: true }, 'REJECTED']]) {
    const records = capture();
    await assert.rejects(() => withDiagnosticOperation('create', 'create', () => diagnosticSubmission('greenfield.create', async () => {
      throw new DmrvnError('STORAGE_UNAVAILABLE', facts);
    }, () => false)));
    assert.equal(events(records, 'failed').length, 1); assert.equal(events(records, 'failed')[0].submission_state, state);
  }
});

test('partner permission failure and failure result both produce diagnostics without member or input data', async () => {
  const records = capture(); let externalCalls = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async () => { externalCalls++; assert.fail('no external calls'); } });
  const wallets = client.userWallets(BackendWalletRegistration.generate(), 'test').forPartner(101, () => false);
  records.length = 0;
  await assert.rejects(() => wallets.getOrCreateSigner(101, 'sensitive-member'));
  assert.equal(externalCalls, 0); assert.equal(events(records, 'failed').length, 1);
  assert.equal(events(records, 'failed')[0].partner_id, '101');
  records.length = 0;
  await withDiagnosticOperation('outcome', 'outcome', () => diagnosticOperation('inner-result', undefined, () => ({ outcome: 'FAILED', errorCode: 'UNAUTHORIZED_SIGNER' })));
  assert.equal(events(records, 'failed').length, 1); assert.equal(events(records, 'failure_handled').length, 1);
  assert.ok(!JSON.stringify(records).includes('sensitive-member'));
});

test('DMRVN checkpoint replay is silent and real mock workflow separates broadcast from submission confirmation', async () => {
  let records = capture(); const evidence = workflowFixture();
  await evidence.prepare('evidence');
  assert.equal(events(records, 'checkpoint').filter(r => r.checkpoint === 'EVIDENCE_SEALED').length, 1);
  const counts = { ...evidence.counts }; records.length = 0;
  await evidence.prepare('evidence');
  assert.equal(events(records, 'checkpoint').length, 0); assert.equal(events(records, 'submission_started').length, 0);
  assert.equal(evidence.counts.creates, counts.creates); assert.equal(evidence.counts.uploads, counts.uploads);
  records = capture(); const f = userActivityFixture(true, { petV3: true });
  const request = new ActivityRequest('sensitive-member', 'source', { petBottleCount: 3 }, { gas: '100000', confirmationTimeoutMs: 100, pollIntervalMs: 1 });
  const result = await f.client.submitActivity(f.wallets, request);
  assert.equal(result.outcome, 'CONFIRMED'); assert.equal(f.facts.sends, 1);
  assert.equal(events(records, 'submission_started').length, 3);
  assert.equal(events(records, 'checkpoint').filter(r => r.checkpoint === 'APPROVED').length, 1);
  assert.equal(events(records, 'submission_confirmed').length, 3);
  assert.equal(events(records, 'completed').length, 1);
  assert.ok(records.every(r => r.operation_id === records[0].operation_id));
  assert.ok(!JSON.stringify(records).includes('sensitive-member'));
});

test('masking bounds messages and excludes secrets, URLs, PEM, JWT, controls and arbitrary adapter messages', async () => {
  const raw = 'token=hello password=world private_key=bad https://host/path eyJhbGciOiJIUzI1NiJ9.abcdef.signature 0x' + 'ab'.repeat(32) + '\u0000';
  const safe = sanitizeDiagnosticMessage(raw);
  for (const secret of ['hello', 'world', 'bad', 'host/path', 'eyJhbG', 'abababab', '\u0000']) assert.ok(!safe.includes(secret));
  assert.equal(sanitizeDiagnosticMessage('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'), '[REDACTED]');
  assert.equal(sanitizeDiagnosticMessage('x '.repeat(1000)).length, 512);
  const records = capture(); await assert.rejects(() => withDiagnosticOperation('adapter', 'safe', async () => { throw new Error('member=alice@example.com'); }));
  assert.equal(records[0]['error.message'], 'SDK operation failed'); assert.ok(!JSON.stringify(records).includes('alice'));
});

test('broken sinks/providers preserve exact results, exception identity and calls; detailed mode creates no spans', async () => {
  let spans = 0, calls = 0;
  trace.setGlobalTracerProvider({ getTracer() { return { startSpan() { spans++; throw new Error('no spans'); }, startActiveSpan() { spans++; throw new Error('no spans'); } }; } });
  const boom = new DmrvnError('INTERRUPTED');
  configureDiagnostics({ detailedLogging: true, localSink() { throw new Error('broken disk'); }, loggerProvider: { getLogger() { throw new Error('broken provider'); } } });
  const object = {};
  assert.equal(await withDiagnosticOperation('ok', 'ok', async () => { calls++; return object; }), object);
  await assert.rejects(() => withDiagnosticOperation('fail', 'fail', async () => { calls++; throw boom; }), error => error === boom);
  assert.equal(calls, 2); assert.equal(spans, 0);
  const records = capture({ detailedLogging: true });
  withDiagnosticOperation('root', 'detail', () => diagnosticOperation('child', undefined, () => diagnosticState('READY', true)));
  assert.ok(records.every(r => r.call_id && typeof r.duration_ms === 'number'));
  assert.ok(records.some(r => r.parent_call_id)); assert.equal(spans, 0); trace.disable();
});

test('async diagnostic callback failures cannot terminate the host process', () => {
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { configureDiagnostics, withDiagnosticOperation } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    let calls = 0;
    configureDiagnostics({
      localSink: async () => { await Promise.resolve(); throw new Error('disk unavailable'); },
      loggerProvider: { getLogger() { return { emit: async () => { throw new Error('export unavailable'); } }; } }
    });
    const value = {}, error = new Error('business failure');
    assert.equal(withDiagnosticOperation('sync', 'sync', () => { calls++; return value; }), value);
    assert.equal(await withDiagnosticOperation('async', 'async', async () => { calls++; return value; }), value);
    await assert.rejects(() => withDiagnosticOperation('failure', 'failure', async () => { calls++; throw error; }), e => e === error);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 3);
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('HTTP status survives body read failure and timeout for RPC and Privy', async () => {
  for (const api of ['rpc-read', 'rpc-send', 'privy']) {
    for (const failure of ['stream', 'timeout']) {
      const records = capture(); let calls = 0;
      const fetch = async () => {
        calls++;
        return new Response(new ReadableStream({ start(controller) {
          if (failure === 'stream') controller.error(new Error('socket closed'));
        } }), { status: 503 });
      };
      const invoke = api === 'privy'
        ? () => new PrivyClient({ appId: 'app', appSecret: 'secret', timeoutMs: 20, fetch }).verifyAppCredentials()
        : () => new HttpEvmRpc('http://localhost:9999', { timeoutMs: 20, fetch }).call(
          api === 'rpc-send' ? 'eth_sendRawTransaction' : 'eth_blockNumber', []);
      await assert.rejects(invoke);
      assert.equal(calls, 1);
      assert.equal(events(records, 'failed').length, 1);
      assert.equal(events(records, 'failed')[0]['http.status_code'], 503, api + ':' + failure);
      if (api === 'rpc-send') assert.equal(events(records, 'failed')[0].submission_state, 'OUTCOME_UNKNOWN');
    }
  }
});

test('built-in partner signer checks permission before submission and sends once after permission is restored', async () => {
  const { memberExternalId } = await import('../dist/index.js');
  const records = capture(), registration = BackendWalletRegistration.generate(); let allowed = true, calls = 0;
  let sends = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
    calls++;
    if (init.method === 'POST') {
      sends++;
      assert.equal(events(records, 'submission_started').length, 1);
      assert.equal(init.headers['privy-idempotency-key'], 'restored');
      return Response.json({ method: 'eth_sendTransaction', data: { hash } });
    }
    return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum', external_id: memberExternalId('service', 'member', 101) }], next_cursor: null });
  } });
  const signer = await client.userWallets(registration, 'service').forPartner(101, () => allowed).getOrCreateSigner(101, 'member');
  const before = calls; allowed = false; records.length = 0;
  const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
  await assert.rejects(() => asset.transfer(signer, address, 1n, 'revoked'), error => error.code === 'SUBMISSION_UNRESOLVED');
  assert.equal(calls, before);
  assert.equal(events(records, 'submission_started').length, 0);
  assert.equal(events(records, 'failed').length, 1);
  assert.equal(events(records, 'failed')[0]['error.code'], 'UNAUTHORIZED_SIGNER');
  assert.equal(events(records, 'failed')[0].submission_state, 'NOT_ATTEMPTED');
  allowed = true; records.length = 0;
  assert.equal(await asset.transfer(signer, address, 1n, 'restored'), hash);
  assert.equal(sends, 1); assert.equal(calls, before + 1);
  assert.deepEqual(records.map(r => r.event), ['submission_started', 'submission_accepted', 'completed']);
  assert.ok(records.every(r => r.operation_id === 'restored'));
});

test('deferred built-in submission retains the DMRVN request identity when restoring its journal', async () => {
  const records = capture(), registration = BackendWalletRegistration.generate(); let sends = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
    if (init.method === 'POST') { sends++; return Response.json({ method: 'eth_sendTransaction', data: { hash } }); }
    return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
  } });
  const signer = await client.signerForWallet('wallet-id', registration); records.length = 0;
  await withDiagnosticOperation('submit-and-resolve', 'outer-id', async () => {
    await diagnosticSubmission('evm.sendTransaction', () => signer.sendTransaction(421614,
      { value: '0x0', gas: '0x1', gasPrice: '0x1', nonce: '0x0' }, 'business-key'), () => true, 'dmrvn-operation', signer);
    diagnosticRestore({ operationId: 'dmrvn-operation', txHash: hash, phase: 'SUBMITTED' });
    diagnosticConfirmed('evm.sendTransaction', 'dmrvn-operation');
  });
  assert.equal(sends, 1);
  assert.deepEqual(records.map(r => r.event), ['submission_started', 'submission_accepted', 'submission_confirmed', 'completed']);
  assert.deepEqual(records.filter(r => r.submission_sequence).map(r => r.submission_sequence), [1, 1, 1]);
  assert.ok(records.every(r => r.operation_id === 'outer-id'));
});

test('built-in submission rejects mismatched RPC methods without recording acceptance', async () => {
  for (const transfer of [false, true]) {
    const records = capture(); let sends = 0;
    const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
      if (init.method === 'POST') { sends++; return Response.json({ method: 'personal_sign', data: { hash } }); }
      return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
    } });
    const signer = await client.signerForWallet('wallet-id', BackendWalletRegistration.generate()); records.length = 0;
    const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
    await assert.rejects(() => transfer ? asset.transfer(signer, address, 1n, 'mismatch') : signer.sendTransaction(421614,
      { value: '0x0', gas: '0x1', gasPrice: '0x1', nonce: '0x0' }, 'mismatch'),
    error => error.code === (transfer ? 'SUBMISSION_UNRESOLVED' : 'RPC_UNAVAILABLE'));
    assert.equal(sends, 1);
    assert.equal(events(records, 'submission_started').length, 1);
    assert.equal(events(records, 'submission_accepted').length, 0);
    assert.equal(events(records, 'failed').length, 1);
    assert.equal(events(records, 'failed')[0].submission_state, 'OUTCOME_UNKNOWN');
  }
});

test('pre-aborted built-in sends never enter the transport submission boundary', async () => {
  for (const transfer of [false, true]) {
    const records = capture(); let sends = 0;
    const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
      if (init.method === 'POST') { sends++; assert.fail('pre-aborted send must not reach fetch'); }
      return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
    } });
    const signer = await client.signerForWallet('wallet-id', BackendWalletRegistration.generate()); records.length = 0;
    const controller = new AbortController(); controller.abort();
    const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
    await assert.rejects(() => transfer ? asset.transfer(signer, address, 1n, 'aborted', controller.signal)
      : signer.sendTransaction(421614, { value: '0x0', gas: '0x1', gasPrice: '0x1', nonce: '0x0' }, 'aborted', controller.signal),
    error => error.code === (transfer ? 'SUBMISSION_UNRESOLVED' : 'INTERRUPTED'));
    assert.equal(sends, 0);
    assert.equal(events(records, 'submission_started').length, 0);
    assert.equal(events(records, 'failed').length, 1);
    assert.equal(events(records, 'failed')[0].submission_state, 'NOT_ATTEMPTED');
  }
});

test('in-flight built-in send cancellation logs one unknown failure without retrying', async () => {
  const records = capture(); let sends = 0;
  const controller = new AbortController();
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
    if (init.method === 'POST') {
      sends++;
      const pending = new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      controller.abort(); return pending;
    }
    return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
  } });
  const signer = await client.signerForWallet('wallet-id', BackendWalletRegistration.generate()); records.length = 0;
  await assert.rejects(() => signer.sendTransaction(421614,
    { value: '0x0', gas: '0x1', gasPrice: '0x1', nonce: '0x0' }, 'cancel', controller.signal), error => error.code === 'INTERRUPTED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends, 1);
  assert.equal(events(records, 'submission_started').length, 1);
  assert.equal(events(records, 'submission_accepted').length, 0);
  assert.equal(events(records, 'failed').length, 1);
  assert.equal(events(records, 'failed')[0].submission_state, 'OUTCOME_UNKNOWN');
});

test('a custom adapter delegating to the built-in signer records acceptance once', async () => {
  const records = capture(); let sends = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
    if (init.method === 'POST') { sends++; return Response.json({ method: 'eth_sendTransaction', data: { hash } }); }
    return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
  } });
  const signer = await client.signerForWallet('wallet-id', BackendWalletRegistration.generate()); records.length = 0;
  const adapter = { address, sendTransaction: (...args) => signer.sendTransaction(...args) };
  const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
  assert.equal(await asset.transfer(adapter, address, 1n, 'adapter-key'), hash);
  assert.equal(sends, 1);
  assert.deepEqual(records.map(r => r.event), ['submission_started', 'submission_accepted', 'completed']);
  assert.deepEqual(events(records, 'submission_accepted').map(r => [r.submission_state, r.submission_sequence]), [['ACCEPTED', 1]]);
});

test('pre-aborted Greenfield create and upload never start a worker or submission', async t => {
  const { storage, requests } = await diagnosticGreenfieldFixture(t, address), records = capture();
  const location = { storageType: 1, chainId: '5600', bucketName: 'bucket', objectName: 'evidence.json' };
  for (const op of ['create', 'upload']) {
    records.length = 0;
    await assert.rejects(() => op === 'create' ? storage.create(location, new Uint8Array([1]), AbortSignal.abort())
      : storage.upload(location, new Uint8Array([1]), 'hash', AbortSignal.abort()), error => error.code === 'INTERRUPTED');
    assert.equal(events(records, 'submission_started').length, 0);
    assert.equal(events(records, 'failed').length, 1);
    assert.equal(events(records, 'failed')[0].submission_state, 'NOT_ATTEMPTED');
  }
  assert.deepEqual(await requests(), []);
});

test('DMRVN pre-send cancellation cannot start nested Greenfield create or upload submissions', async t => {
  const { DmrvnClient } = await import('../dist/index.js');
  for (const op of ['create', 'upload']) {
    await t.test(op, async subtest => {
      const f = workflowFixture(), { storage, requests } = await diagnosticGreenfieldFixture(subtest, f.storage.address);
      const records = capture(), controller = new AbortController(), store = f.journal.store.bind(f.journal);
      f.journal.store = async (key, state) => {
        await store(key, state);
        if ((op === 'create' && state.createIntent) || (op === 'upload' && state.objectExists)) controller.abort();
      };
      const client = new DmrvnClient(f.config, f.rpc, f.operator, storage, f.methodology, f.journal);
      await assert.rejects(() => client.prepareEvidence('cancel-' + op, f.claimId, f.beneficiary,
        f.objectName, f.body, controller.signal), error => error.code === 'INTERRUPTED');
      assert.equal(events(records, 'submission_started').filter(r => r.submission_target === 'greenfield.' + op).length, 0);
      assert.equal(events(records, 'failed').length, 1);
      const operations = (await requests()).map(r => r.op);
      assert.deepEqual(operations, op === 'create' ? ['head'] : ['head', 'create', 'head']);
      if (op === 'create') assert.equal(events(records, 'failed')[0].submission_state, 'NOT_ATTEMPTED');
      else {
        assert.equal(events(records, 'failed')[0].submission_target, 'greenfield.create');
        assert.equal(events(records, 'failed')[0].submission_state, 'ACCEPTED');
      }
    });
  }
});

test('nested Greenfield worker submissions retain DMRVN identity and original call counts', async t => {
  const { DmrvnClient } = await import('../dist/index.js');
  const f = workflowFixture(), { storage, requests } = await diagnosticGreenfieldFixture(t, f.storage.address), records = capture();
  const client = new DmrvnClient(f.config, f.rpc, f.operator, storage, f.methodology, f.journal);
  await withDiagnosticOperation('greenfield-workflow', 'outer', async () => {
    const state = await client.prepareEvidence('storage-operation', f.claimId, f.beneficiary, f.objectName, f.body);
    assert.equal(state.phase, 'EVIDENCE_SEALED');
    assert.equal((await client.operation('storage-operation')).phase, 'EVIDENCE_SEALED');
  });
  assert.deepEqual((await requests()).map(r => r.op), ['head', 'create', 'head', 'upload', 'head', 'read']);
  for (const event of ['submission_started', 'submission_accepted', 'submission_confirmed']) {
    assert.deepEqual(events(records, event).map(r => [r.submission_target, r.submission_sequence]),
      [['greenfield.create', 1], ['greenfield.upload', 2]]);
  }
  assert.equal(events(records, 'completed').length, 1);
  assert.ok(records.every(r => r.operation_id === 'outer'));
});

test('Greenfield HTTP failures retain status through response errors and timeouts', async () => {
  const { GreenfieldPublicReader } = await import('../dist/index.js');
  for (const status of [403, 429, 503]) {
    for (const mode of ['response', 'stream', 'timeout']) {
      const records = capture(); let calls = 0;
      const reader = new GreenfieldPublicReader('https://storage.invalid', '5600', { timeoutMs: 20, fetch: async () => {
        calls++;
        const body = mode === 'response' ? '' : new ReadableStream({ start(controller) {
          if (mode === 'stream') controller.error(new Error('socket closed'));
        } });
        return new Response(body, { status });
      } });
      await assert.rejects(() => reader.read({ storageType: 1, chainId: '5600', bucketName: 'bucket', objectName: 'object' }));
      assert.equal(calls, 1);
      assert.equal(events(records, 'failed').length, 1);
      assert.equal(events(records, 'failed')[0]['http.status_code'], status, status + ':' + mode);
    }
  }
});

test('actual bounded batch OTLP HTTP export matches local records and uses LogRecord timestamps', async () => {
  const payloads = [], headers = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    payloads.push(JSON.parse(Buffer.concat(chunks))); headers.push(req.headers);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const exporter = new OTLPLogExporter({ url: `http://127.0.0.1:${server.address().port}/v1/logs`, headers: { authorization: 'test-only-secret' } });
  const provider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({ exporter, maxQueueSize: 32, maxExportBatchSize: 8, scheduledDelayMillis: 10000 })] });
  try {
    const records = capture({ loggerProvider: provider });
    await withDiagnosticOperation('otlp', 'otlp:1', async () => diagnosticSubmission('send', async () => hash, () => true));
    const secret = '0x' + 'de'.repeat(32);
    const rpc = new HttpEvmRpc('http://localhost:9999', { fetch: async (_url, init) => Response.json({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: secret } }) });
    await assert.rejects(() => rpc.call('eth_call', []));
    assert.equal(payloads.length, 0); await provider.forceFlush();
    assert.ok(!JSON.stringify(payloads).includes(secret)); assert.ok(!JSON.stringify(records).includes(secret));
    const logs = payloads.flatMap(p => p.resourceLogs.flatMap(r => r.scopeLogs.flatMap(s => s.logRecords)));
    assert.equal(logs.length, records.length);
    assert.ok(logs.every(r => BigInt(r.timeUnixNano) > 0n));
    assert.deepEqual(logs.map(r => Object.fromEntries(r.attributes.map(a => [a.key, a.value.stringValue ?? a.value.intValue ?? a.value.doubleValue ?? a.value.boolValue]))).map(r => r.operation_id), records.map(r => r.operation_id));
    assert.equal(headers[0].authorization, 'test-only-secret');
    assert.ok(!JSON.stringify(records).includes('test-only-secret')); assert.ok(logs.every(r => !r.traceId && !r.spanId));
  } finally { await provider.shutdown(); server.close(); await once(server, 'close'); }
});


test('actual RPC-to-query exception translation preserves the first error and HTTP status once', async () => {
  const records = capture(); let calls = 0;
  const rpc = new HttpEvmRpc('http://localhost:9999', { fetch: async () => { calls++; return new Response('never-log-upstream-body', { status: 503 }); } });
  await assert.rejects(() => new EvmTransactionClient(421614, rpc).getTransaction(hash), error => error.code === 'RPC_UNAVAILABLE');
  assert.equal(calls, 1); assert.equal(events(records, 'failed').length, 1);
  assert.equal(records[0].failed_stage, 'evm-rpc.call'); assert.equal(records[0]['http.status_code'], 503);
  assert.ok(!JSON.stringify(records).includes('never-log-upstream-body'));
});

test('unsafe Error accessors still emit a fixed safe fallback', async () => {
  const records = capture(), error = new Error();
  Object.defineProperty(error, 'name', { get() { throw new Error('unsafe'); } });
  await assert.rejects(() => withDiagnosticOperation('unsafe', 'unsafe', async () => { throw error; }), caught => caught === error);
  assert.equal(events(records, 'failed').length, 1); assert.equal(records[0]['error.message'], 'SDK operation failed');
});

test('direct member-wallet function aliases preserve one summary across pagination and log missing signer once', async () => {
  const records = capture(); let calls = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async () => {
    calls++; return Response.json({ data: [], next_cursor: calls % 3 === 0 ? null : 'page-' + calls });
  } });
  const wallets = client.userWallets(new BackendWalletRegistration('public', 'private'), 'service');
  records.length = 0;
  assert.equal(await wallets.findWallet('sensitive-member'), null);
  assert.equal(calls, 3); assert.equal(records.length, 1); assert.equal(records[0].operation, 'wallets.findWallet');
  records.length = 0;
  await assert.rejects(() => wallets.signerFor('sensitive-member'));
  assert.equal(calls, 6); assert.equal(records.length, 1); assert.equal(records[0].event, 'failed');
  assert.equal(records[0].operation, 'wallets.signerFor'); assert.ok(!JSON.stringify(records).includes('sensitive-member'));
});

test('upstream and exception codes redact opaque values while preserving numeric and symbolic codes', async () => {
  const exported = [], records = capture({ loggerProvider: { getLogger() { return { emit(record) { exported.push(record); } }; } } });
  const secrets = ['0x' + 'ab'.repeat(32), 'OpaqueSecretValue'.repeat(4), 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.signature', 'ewogImFsZyI6Im5vbmUiIH0.eyJzdWIiOjF9.'];
  for (const secret of secrets) {
    const rpc = new HttpEvmRpc('http://localhost:9999', { fetch: async (_url, init) => Response.json({
      jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: secret, message: 'untrusted' },
    }) });
    await assert.rejects(() => rpc.call('eth_call', []));
    await assert.rejects(() => withDiagnosticOperation('adapter', 'safe', async () => { throw Object.assign(new Error(), { code: secret }); }));
    assert.ok(!JSON.stringify(records).includes(secret)); assert.ok(!JSON.stringify(exported).includes(secret));
  }
  records.length = 0;
  const rpc = new HttpEvmRpc('http://localhost:9999', { fetch: async (_url, init) => Response.json({
    jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32000, message: 'untrusted' },
  }) });
  await assert.rejects(() => rpc.call('eth_call', []));
  assert.equal(events(records, 'failed')[0]['upstream.code'], '-32000');
  await assert.rejects(() => withDiagnosticOperation('adapter', 'safe', async () => { throw Object.assign(new Error(), { code: 'ECONNRESET' }); }));
  assert.equal(events(records, 'failed').at(-1)['error.code'], 'ECONNRESET');
});

test('wallet creation and standalone broadcast log a single normalized transport failure without retry', async () => {
  for (const kind of ['wallet', 'broadcast']) {
    const records = capture(); let calls = 0;
    const fetch = async () => { calls++; throw new TypeError('fetch failed with secret'); };
    const invoke = kind === 'wallet'
      ? () => new PrivyClient({ appId: 'app', appSecret: 'secret', fetch }).registerBackendWallet(new BackendWalletRegistration('public', 'private'), { chainType: 'ethereum' })
      : () => new HttpEvmRpc('http://localhost:9999', { fetch }).call('eth_sendRawTransaction', ['never-log-signed-data']);
    const code = kind === 'wallet' ? 'UNAVAILABLE' : 'RPC_UNAVAILABLE';
    await assert.rejects(invoke, error => error.code === code);
    assert.equal(calls, 1); assert.equal(events(records, 'failed').length, 1);
    assert.equal(events(records, 'failed')[0]['error.code'], code);
    assert.equal(events(records, 'failed')[0].submission_state, 'OUTCOME_UNKNOWN');
    assert.equal(events(records, 'submission_started').length, 1);
    assert.ok(!JSON.stringify(records).includes('fetch failed with secret'));
  }
});

test('restoring a different DMRVN operation cannot confirm or renumber an unrelated transfer', async () => {
  const { resolutionFixture } = await import('./helpers/dmrvn-resolution.mjs');
  const records = capture(), f = await resolutionFixture(true); records.length = 0; let sends = 0;
  await withDiagnosticOperation('group', 'group', async () => {
    const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
    await asset.transfer({ address, async sendTransaction() { sends++; return hash; } }, address, 1n, 'unrelated-A');
    assert.equal((await f.client.resolveSubmission(f.operation, f.hash)).status, 'CONFIRMED');
    // A second read of the journal must keep the confirmed request identity and emit no transitions.
    await f.client.resolveSubmission(f.operation, f.hash);
  });
  assert.equal(sends, 1);
  const transitions = records.filter(r => r.event.startsWith('submission_'));
  assert.deepEqual(transitions.map(r => [r.event, r.submission_sequence]), [
    ['submission_started', 1], ['submission_accepted', 1], ['submission_accepted', 2], ['submission_confirmed', 2],
  ]);
  assert.ok(records.every(r => r.operation_id === 'group'));
});

test('DMRVN restoration retains the live submission sequence rather than creating another request', async () => {
  const records = capture(), f = userActivityFixture(true, { petV3: true });
  const result = await f.client.submitActivity(f.wallets, new ActivityRequest('member', 'source', { petBottleCount: 3 }, { gas: '100000', confirmationTimeoutMs: 100, pollIntervalMs: 1 }));
  assert.equal(result.outcome, 'CONFIRMED'); assert.equal(f.facts.sends, 1);
  for (const event of ['submission_started', 'submission_accepted', 'submission_confirmed']) {
    assert.deepEqual(events(records, event).map(r => r.submission_sequence), [1, 2, 3]);
  }
});

test('partner signers restore the bound partner for every independently invoked permission check', async () => {
  const { memberExternalId } = await import('../dist/index.js');
  const records = capture(), registration = BackendWalletRegistration.generate(); let allowed = true, calls = 0;
  const client = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async () => {
    calls++; return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum', external_id: memberExternalId('service', 'member', 101) }], next_cursor: null });
  } });
  const wallets = client.userWallets(registration, 'service').forPartner(101, () => allowed);
  const signer = await wallets.getOrCreateSigner(101, 'member');
  const before = calls; allowed = false; records.length = 0;
  for (const invoke of [() => signer.signMessage('do-not-log'), () => signer.signTypedData({ domain: {}, types: {}, primaryType: 'X', message: {} }),
    () => signer.sendTransaction(421614, { value: '0x1', gas: '0x1', gasPrice: '0x1', nonce: '0x0' }, 'business-key')]) {
    await assert.rejects(invoke, error => error.code === 'UNAUTHORIZED_SIGNER');
  }
  assert.equal(calls, before); assert.equal(events(records, 'failed').length, 3);
  assert.ok(records.every(r => r.partner_id === '101'));
  assert.equal(new Set(records.map(r => r.operation_id)).size, 3);
  records.length = 0;
  await assert.rejects(() => wallets.getOrCreateSigner(102, 'member'), error => error.code === 'UNAUTHORIZED_SIGNER');
  assert.equal(calls, before); assert.equal(records[0].partner_id, '101');
});


test('parallel journal restoration cannot overwrite an in-flight sibling submission', async () => {
  const records = capture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  await withDiagnosticOperation('parallel-restore', 'group', async () => {
    await Promise.allSettled([
      diagnosticOperation('live-A', undefined, () => diagnosticSubmission('evm.sendTransaction', async () => {
        await gate; throw new DmrvnError('RPC_UNAVAILABLE');
      }, () => true)),
      diagnosticOperation('restore-B', undefined, async () => {
        try {
          diagnosticRestore({ operationId: 'B', phase: 'BROADCAST_INTENT', submitFromBlock: 100 });
          diagnosticConfirmed('evm.sendTransaction', 'B');
        } finally { release(); }
      }),
    ]);
  });
  const failed = events(records, 'failed');
  assert.equal(failed.length, 1); assert.equal(failed[0].failed_stage, 'live-A');
  assert.equal(failed[0].submission_sequence, 1); assert.equal(failed[0].submission_state, 'OUTCOME_UNKNOWN');
  assert.deepEqual(events(records, 'submission_confirmed').map(r => r.submission_sequence), [2]);
});

test('stale journals preserve observed acceptance and confirmation for the same request', async () => {
  for (const target of ['evm.sendTransaction', 'greenfield.create']) {
    for (const confirmed of [false, true]) {
      const records = capture(); let sends = 0;
      await withDiagnosticOperation('restore', 'restore', async () => {
        await diagnosticSubmission(target, async () => { sends++; return hash; }, () => true, 'A');
        if (confirmed) diagnosticConfirmed(target, 'A');
        const stale = target === 'evm.sendTransaction'
          ? [{ submitFromBlock: 100 }, { txHash: hash }]
          : [{ createIntent: true }, { createTxHash: hash }];
        for (const snapshot of stale) {
          diagnosticRestore({ operationId: 'A', phase: 'BROADCAST_INTENT', ...snapshot });
          await assert.rejects(() => diagnosticOperation('rpc', undefined, async () => { throw new DmrvnError('RPC_UNAVAILABLE'); }));
        }
        diagnosticConfirmed(target, 'A');
      });
      assert.equal(sends, 1);
      assert.deepEqual(events(records, 'failed').map(r => [r.submission_state, r.submission_sequence]),
        [[confirmed ? 'CONFIRMED' : 'ACCEPTED', 1], [confirmed ? 'CONFIRMED' : 'ACCEPTED', 1]]);
      assert.equal(events(records, 'submission_accepted').length, 1);
      assert.equal(events(records, 'submission_confirmed').length, 1);
    }
  }
});

test('journal restoration can advance an unknown request to accepted and confirmed', async () => {
  const records = capture();
  await withDiagnosticOperation('restore-progress', 'restore-progress', async () => {
    await diagnosticSubmission('evm.sendTransaction', async () => undefined, () => false, 'A');
    for (const submissionStatus of [undefined, 'CONFIRMED']) {
      diagnosticRestore({ operationId: 'A', phase: 'BROADCAST_INTENT', txHash: hash, submissionStatus });
      await assert.rejects(() => diagnosticOperation('rpc', undefined, async () => { throw new DmrvnError('RPC_UNAVAILABLE'); }));
    }
  });
  assert.deepEqual(events(records, 'failed').map(r => [r.submission_state, r.submission_sequence]),
    [['ACCEPTED', 1], ['CONFIRMED', 1]]);
  assert.equal(events(records, 'submission_started').length, 1);
  assert.equal(events(records, 'submission_accepted').length, 0);
  assert.equal(events(records, 'submission_confirmed').length, 0);
});

test('hash persistence failure followed by resolution preserves acceptance without another send', async () => {
  const records = capture(), f = userActivityFixture(true, { petV3: true });
  const store = f.journal.store.bind(f.journal); let failOnce = true;
  f.journal.store = async (key, state) => {
    if (failOnce && state.txHash) { failOnce = false; throw new DmrvnError('JOURNAL_UNAVAILABLE'); }
    return store(key, state);
  };
  await withDiagnosticOperation('recover-submit', 'recover-submit', async () => {
    const outcome = await f.client.submitActivity(f.wallets,
      new ActivityRequest('member', 'source', { petBottleCount: 3 }, { gas: '100000' }));
    assert.equal(outcome.outcome, 'UNKNOWN'); assert.ok(outcome.confirmed.txHash);
    assert.equal((await f.journal.load('operation:' + outcome.confirmed.operationId)).txHash, undefined);
    f.rpc.call = async () => { throw new DmrvnError('RPC_UNAVAILABLE'); };
    await assert.rejects(() => f.client.resolveSubmission(outcome.confirmed.operationId, outcome.confirmed.txHash));
  });
  assert.equal(f.facts.sends, 1);
  const accepted = events(records, 'submission_accepted').find(r => r.submission_target === 'evm.sendTransaction');
  const failed = events(records, 'failed').find(r => r['error.code'] === 'RPC_UNAVAILABLE');
  assert.ok(accepted); assert.ok(failed);
  assert.equal(failed.submission_state, 'ACCEPTED');
  assert.equal(failed.submission_sequence, accepted.submission_sequence);
});

test('successful recovery of journal readiness emits a completion rather than a new failure', async () => {
  const records = capture(), f = workflowFixture();
  await f.prepare(); await f.client.approveClaim('operation-one');
  const call = f.rpc.call.bind(f.rpc); let unavailable = true, calls = 0;
  f.rpc.call = async (...args) => { calls++; if (unavailable) throw new DmrvnError('RPC_UNAVAILABLE'); return call(...args); };
  await assert.rejects(() => f.client.prepareSponsored('operation-one', '100000'));
  assert.equal((await f.journal.load('operation:operation-one')).ready, false);
  unavailable = false; records.length = 0;
  const result = await f.client.prepareSponsored('operation-one', '100000');
  assert.ok(result.forwardRequest); assert.ok(calls > 0);
  assert.deepEqual(records.map(r => r.event), ['completed']);
  assert.equal((await f.journal.load('operation:operation-one')).ready, true);
});

test('only the preflight result contract treats ready=false as a failure result', async () => {
  const records = capture(), snapshot = { ready: false, phase: 'APPROVED' };
  assert.equal(withDiagnosticOperation('snapshot', 'snapshot', () => snapshot), snapshot);
  assert.deepEqual(records.map(r => r.event), ['completed']);
  const f = workflowFixture();
  f.rpc.call = async () => { throw new DmrvnError('RPC_UNAVAILABLE'); }; records.length = 0;
  const result = await f.client.preflight();
  assert.equal(result.ready, false);
  assert.ok(events(records, 'failed').length > 0);
  assert.equal(events(records, 'failure_handled').length, 1);
  assert.equal(events(records, 'completed').length, 1);
});

test('report read errors retain their first stage and are handled once after translation', async () => {
  const { reportFixture } = await import('./helpers/dmrvn-report.mjs');
  const { DmrvnReader, GreenfieldPublicReader } = await import('../dist/index.js');
  const records = capture(), f = reportFixture(); let reads = 0;
  const storage = new GreenfieldPublicReader('https://storage.invalid', '5600', { fetch: async () => {
    reads++; return new Response('untrusted upstream body', { status: 503 });
  } });
  const reader = new DmrvnReader(f.config, f.rpc, storage, f.resolver);
  const result = await reader.readResult(f.id, undefined, f.hash);
  assert.equal(result.reportError.code, 'REPORT_READ_FAILED'); assert.equal(reads, 1);
  assert.equal(events(records, 'failed').length, 1);
  assert.equal(events(records, 'failed')[0].failed_stage, 'greenfield-public-reader.read');
  assert.equal(events(records, 'failure_handled').length, 1);
  assert.equal(events(records, 'completed').length, 1);
  assert.ok(!JSON.stringify(records).includes('untrusted upstream body'));
});

test('a completed signer remains the last confirmed stage when the returned hash is invalid', async () => {
  for (const detailedLogging of [false, true]) {
    const records = capture({ detailedLogging }), registration = BackendWalletRegistration.generate(); let sends = 0;
    const privy = new PrivyClient({ appId: 'app', appSecret: 'secret', fetch: async (_url, init) => {
      if (init.method === 'GET') return Response.json({ data: [{ id: 'wallet-id', address, chain_type: 'ethereum' }], next_cursor: null });
      sends++; return Response.json({ method: 'eth_sendTransaction', data: { hash: 'invalid-hash' } });
    } });
    const signer = await privy.signerForWallet('wallet-id', registration); records.length = 0;
    const asset = new AssetClient({ async call(method) { return method === 'eth_chainId' ? '0x66eee' : '0x1'; } });
    await assert.rejects(() => asset.transfer(signer, address, 1n, 'invalid-hash'), error => error.code === 'SUBMISSION_UNRESOLVED');
    const failed = events(records, 'failed');
    assert.equal(sends, 1); assert.equal(failed.length, 1);
    assert.equal(failed[0].last_confirmed_stage, 'privy-signer.sendTransaction');
    assert.equal(failed[0].submission_state, 'OUTCOME_UNKNOWN');
    if (detailedLogging) assert.ok(records.every(r => !r.parent_call_id || r.call_id !== r.parent_call_id));
  }
});

test('submission contexts propagate nested stage and state without introducing a call relation cycle', async () => {
  const records = capture({ detailedLogging: true });
  await assert.rejects(() => withDiagnosticOperation('outer', 'stage-state', async () => {
    await diagnosticSubmission('send', () => diagnosticOperation('sdk-child', undefined, async () => {
      diagnosticState('CHILD_READY'); return hash;
    }), () => true);
    throw new DmrvnError('RPC_UNAVAILABLE');
  }));
  const failed = events(records, 'failed')[0];
  assert.equal(failed.last_confirmed_stage, 'sdk-child'); assert.equal(failed.last_confirmed_state, 'CHILD_READY');
  assert.ok(records.every(r => !r.parent_call_id || r.parent_call_id !== r.call_id));
});
