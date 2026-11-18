import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnClient, DmrvnConfig, DmrvnError } from '../dist/index.js';

import { DmrvnJson } from '../dist/dmrvn-json.js';
import { MemoryOperationJournal } from '../dist/memory-operation-journal.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';

const code = expected => error => { assert.equal(error.code, expected); return true; };

test('Evidence 준비는 서명·생성 adapter·원래 hash 업로드·실제 bytes 비교 후 SEALED를 저장한다', async () => {
  const item = workflowFixture();
  const result = await item.prepare();
  assert.equal(result.phase, 'EVIDENCE_SEALED');
  assert.equal(result.ready, true);
  assert.equal(result.createIntent, true);
  assert.equal(result.objectExists, true);
  assert.equal(result.upload.status, 'SEALED');
  assert.equal(result.upload.evidenceHash, DmrvnJson.hash(result.evidence));
  assert.equal(result.upload.createTxHash, item.objects.get(item.objectName).hash);
  assert.deepEqual([...item.objects.get(item.objectName).bytes], [...DmrvnJson.bytes(result.evidence)]);
  assert.deepEqual(item.counts, { messages: 1, typed: 0, creates: 1, uploads: 1, heads: 3, reads: 1, proofs: 0, registry: 1 });
  result.evidence.inputs.arbitraryInput[0] = 99;
  assert.equal((await item.client.operation('operation-one')).evidence.inputs.arbitraryInput[0], 3);
});

test('같은 operation의 동시 재개는 원래 서명과 생성 hash를 재사용한다', async () => {
  const item = workflowFixture();
  const results = await Promise.all(Array.from({ length: 16 }, () => item.prepare()));
  assert.equal(new Set(results.map(result => result.upload.evidenceHash)).size, 1);
  assert.equal(item.counts.messages, 1); assert.equal(item.counts.creates, 1); assert.equal(item.counts.uploads, 1);
});

test('SEALED 재호출은 배포를 재확인하되 역할·방법론·저장소를 다시 읽지 않는다', async () => {
  const item = workflowFixture();
  const first = await item.prepare();
  const before = { ...item.counts };
  item.state.role = false; item.status.active = false;
  item.storage.head = async () => { assert.fail('SEALED 빠른 반환은 storage를 읽지 않는다'); };
  const second = await item.prepare();
  assert.equal(second.upload.evidenceHash, first.upload.evidenceHash);
  assert.deepEqual(item.counts, before);
});

test('입력·설정 fingerprint와 claim/source 예약 충돌을 검사하고 예약은 되돌리지 않는다', async () => {
  const item = workflowFixture();
  await item.prepare();
  await assert.rejects(item.prepare('operation-one', '0x' + '22'.repeat(32)), code('OPERATION_INPUT_CHANGED'));
  await assert.rejects(item.prepare('operation-one', item.claimId, item.objectName, { ...item.body, sourceEventId: 'changed' }), code('OPERATION_INPUT_CHANGED'));
  await assert.rejects(item.prepare('different-operation'), code('NONCE_CONFLICT'));
  const nextClaim = '0x' + '33'.repeat(32);
  await assert.rejects(item.prepare('source-collision', nextClaim), code('NONCE_CONFLICT'));
  assert.equal((await item.journal.load('claim-id:' + nextClaim)).operationId, 'source-collision');
  assert.equal((await item.client.operation('source-collision')).phase, 'PREPARING');
  const changed = DmrvnConfig.fromDeployment(item.config.deployment, { ...item.config, objectPrefix: 'changed/' });
  const other = new DmrvnClient(changed, item.rpc, item.operator, item.storage, item.methodology, item.journal);
  await assert.rejects(other.operation('operation-one'), code('OPERATION_INPUT_CHANGED'));
});

test('claim-id 검색은 과거 인덱스 없는 다른 deployment 작업도 차단한다', async () => {
  const item = workflowFixture();
  await item.journal.store('operation:legacy', { claimId: item.claimId, operationId: 'legacy', deploymentId: '1:other-deployment' });
  await assert.rejects(item.prepare(), code('DEPLOYMENT_COLLISION'));
  assert.equal(item.counts.messages, 0); assert.equal(item.counts.creates, 0);
});

test('생성 응답 유실은 intent를 유지하고 원래 거래 복구 후 create 없이 업로드한다', async () => {
  const item = workflowFixture();
  const create = item.storage.create.bind(item.storage);
  item.storage.create = async (...args) => { await create(...args); throw new DmrvnError('STORAGE_UNAVAILABLE'); };
  await assert.rejects(item.prepare(), code('STORAGE_UNAVAILABLE'));
  assert.equal((await item.client.operation('operation-one')).createIntent, true);
  await assert.rejects(item.prepare(), code('STORAGE_CREATE_UNRESOLVED'));
  const hash = item.objects.get(item.objectName).hash;
  await assert.rejects(item.client.recoverCreateTransaction('operation-one', 'wrong-hash'), code('STORAGE_MISMATCH'));
  await item.client.recoverCreateTransaction('operation-one', hash);
  const result = await item.prepare();
  assert.equal(result.upload.createTxHash, hash);
  assert.equal(item.counts.creates, 1); assert.equal(item.counts.messages, 1); assert.equal(item.counts.uploads, 1);
});

test('생성의 명확한 미전송/CheckTx 거절만 intent를 제거하고 동일 작업에서 생성 재시도를 허용한다', async () => {
  for (const flag of ['definitelyNotBroadcast', 'definitelyRejected']) {
    const item = workflowFixture();
    const create = item.storage.create.bind(item.storage);
    let attempts = 0;
    item.storage.create = async (...args) => {
      if (++attempts === 1) throw new DmrvnError('STORAGE_UNAVAILABLE', { [flag]: true });
      return create(...args);
    };
    await assert.rejects(item.prepare(), code('STORAGE_UNAVAILABLE'));
    const failed = await item.client.operation('operation-one');
    assert.equal(Object.hasOwn(failed, 'createIntent'), false);
    assert.equal(failed.lastStorageError, 'STORAGE_UNAVAILABLE');
    const result = await item.prepare();
    assert.equal(result.upload.status, 'SEALED'); assert.equal(Object.hasOwn(result, 'lastStorageError'), false);
    assert.equal(attempts, 2); assert.equal(item.counts.messages, 1);
  }
});

test('intent가 있고 객체가 없으면 hash 복구 여부와 무관하게 create를 재호출하지 않는다', async () => {
  const item = workflowFixture();
  let attempts = 0;
  item.storage.create = async () => { attempts++; throw new DmrvnError('STORAGE_UNAVAILABLE'); };
  await assert.rejects(item.prepare(), code('STORAGE_UNAVAILABLE'));
  item.storage.matchesCreateTransaction = async () => true;
  await item.client.recoverCreateTransaction('operation-one', 'verified-original-hash');
  await assert.rejects(item.prepare(), code('STORAGE_CREATE_UNRESOLVED'));
  assert.equal(attempts, 1); assert.equal(item.counts.uploads, 0);
});

test('기존 sealed 객체는 정확한 바이트면 재생성 없이 수용하고 JSON이 같아도 bytes가 다르면 거부한다', async () => {
  for (const tampered of [false, true]) {
    const item = workflowFixture();
    const signature = await item.wallet.signMessage('DMRVN v4 source:' + DmrvnJson.hash(item.body));
    const evidence = { ...item.body, provenance: { signer: item.operator.address, sourceSignature: signature } };
    const bytes = Buffer.concat([DmrvnJson.bytes(evidence), tampered ? Buffer.from('\n') : Buffer.alloc(0)]);
    item.objects.set(item.objectName, { bytes, sealed: true, hash: 'existing-object-hash' });
    if (tampered) await assert.rejects(item.prepare(), code('STORAGE_MISMATCH'));
    else assert.equal((await item.prepare()).upload.createTxHash, null);
    assert.equal(item.counts.creates, 0); assert.equal(item.counts.uploads, 0); assert.equal(item.counts.proofs, 0);
  }
});

test('create intent 저장 직후 실패하면 create를 호출하지 않고 불명확 상태를 유지한다', async () => {
  const base = new MemoryOperationJournal();
  let fail = true;
  const journal = { withLock: base.withLock.bind(base), load: base.load.bind(base), findOperationsByClaimId: base.findOperationsByClaimId.bind(base),
    async store(key, value) {
      await base.store(key, value);
      if (fail && key.startsWith('operation:') && value.createIntent && !value.createTxHash) { fail = false; throw new DmrvnError('JOURNAL_UNAVAILABLE'); }
    } };
  const item = workflowFixture(journal);
  await assert.rejects(item.prepare(), code('JOURNAL_UNAVAILABLE'));
  await assert.rejects(item.prepare(), code('STORAGE_CREATE_UNRESOLVED'));
  assert.equal(item.counts.creates, 0);
});

test('배포 재검증 실패는 이전 verifiedMetadata를 지우고 원래 body·서명·upload를 보존한다', async () => {
  const item = workflowFixture();
  const first = await item.prepare();
  item.rpc.call = async () => { throw new DmrvnError('RPC_UNAVAILABLE'); };
  await assert.rejects(item.prepare(), code('DEPLOYMENT_NOT_READY'));
  const saved = await item.client.operation('operation-one');
  assert.equal(saved.ready, false); assert.equal(Object.hasOwn(saved, 'verifiedMetadata'), false);
  assert.equal(saved.deploymentError, 'DEPLOYMENT_NOT_READY');
  assert.equal(saved.upload.evidenceHash, first.upload.evidenceHash);
  assert.equal(saved.evidence.provenance.sourceSignature, first.evidence.provenance.sourceSignature);
});

test('오류의 retryable/action은 재전송 허가가 아니며 provenance 포함 1 MiB 경계를 검사한다', async () => {
  assert.equal(new DmrvnError('STORAGE_CREATE_UNRESOLVED').action(), 'RECONCILE_ONLY');
  assert.equal(new DmrvnError('STORAGE_ACCOUNT_UNFUNDED').action(), 'FUND_CONFIGURED_ROLE');
  const item = workflowFixture();
  const empty = item.methodology.evidenceBody(101, item.beneficiary, 'source-event', { padding: '' });
  const body = item.methodology.evidenceBody(101, item.beneficiary, 'source-event', { padding: 'x'.repeat(1048576 - DmrvnJson.bytes(empty).length) });
  await assert.rejects(item.prepare('operation-one', item.claimId, item.objectName, body), code('INVALID_INPUT'));
  assert.equal(item.counts.messages, 1); assert.equal(item.counts.creates, 0);
  assert.equal(Object.hasOwn(await item.client.operation('operation-one'), 'evidence'), false);
});
