import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { DmrvnClient, DmrvnCrypto, DmrvnError, DmrvnJson, DmrvnProtocol, MemoryOperationJournal } from '../dist/index.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';

const operation = 'operation-one';
const key = 'operation:' + operation;
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);

test('Claim 승인은 정확한 nonce/deadline·전체 Evidence hash·원래 배포를 결속하고 동시 호출도 한 번 서명한다', async () => {
  const f = workflowFixture(); await f.prepare();
  const saved = await f.client.operation(operation);
  const values = await Promise.all(Array.from({ length: 16 }, () => f.client.approveClaim(operation)));
  const approved = values[0], request = approved.claimRequest;
  assert.equal(f.counts.typed, 1);
  for (const value of values) assert.deepEqual(value, approved);
  assert.deepEqual(Object.keys(approved).sort(), ['approvalDigest', 'approvalSignature', 'claimRequest', 'deployment']);
  assert.deepEqual(request, DmrvnJson.copy({ claimId: f.claimId, beneficiary: f.beneficiary, partnerId: 101, activityId: 1003,
    methodologyId: 2003, methodologyVersion: 1, evidenceHash: DmrvnJson.hash(saved.evidence), methodologyHash: f.methodology.hash(),
    evidenceLocation: saved.evidenceLocation, nonce: '9007199254740993', deadline: '1191' }));
  assert.equal(DmrvnProtocol.recover(approved.approvalDigest, approved.approvalSignature), f.wallet.address.toLowerCase());
  assert.deepEqual(approved.deployment, saved.deployment);
  const state = await f.client.operation(operation); assert.equal(state.phase, 'APPROVED');
  assert.deepEqual(await f.journal.load(`claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`), DmrvnJson.copy({ operationId: operation }));
  request.nonce = '0'; approved.deployment.observedBlock = 0;
  assert.equal((await f.client.approveClaim(operation)).claimRequest.nonce, '9007199254740993');
});

test('승인 빠른 반환은 배포만 다시 확인하고 만료·역할·registry·저장소를 반복하지 않는다', async () => {
  const f = workflowFixture(); await f.prepare(); const approved = await f.client.approveClaim(operation);
  f.state.timestamp = 100000n; f.state.claimNonce = '33'; f.state.role = false; f.status.active = false;
  f.state.implementation = f.second; f.state.version = '1.0.1';
  f.storage.head = f.storage.read = async () => assert.fail('캐시 승인 경로의 storage 접근');
  const counts = { ...f.counts };
  assert.deepEqual(await f.client.approveClaim(operation), approved);
  assert.deepEqual(f.counts, counts);
  const state = await f.client.operation(operation);
  assert.equal(state.verifiedMetadata.implementationAddress, f.second);
  assert.deepEqual(state.approved.deployment, approved.deployment);
  f.state.version = 'not-approved';
  await rejects(() => f.client.approveClaim(operation), 'UNAPPROVED_IMPLEMENTATION');
  assert.equal((await f.client.operation(operation)).ready, false);
});

test('서명 실패 후 요청을 재사용하고 nonce/만료를 자동 갱신하지 않는다', async () => {
  const f = workflowFixture(); await f.prepare();
  const sign = f.operator.signTypedData;
  const failure = new Error('offline signer failure'); f.operator.signTypedData = async () => { throw failure; };
  await assert.rejects(() => f.client.approveClaim(operation), error => error === failure);
  const saved = (await f.client.operation(operation)).claimRequest;
  assert.equal(saved.deadline, '1191');
  f.operator.signTypedData = sign; f.state.claimNonce = '9007199254740994';
  await rejects(() => f.client.approveClaim(operation), 'NONCE_CONFLICT'); assert.equal(f.counts.typed, 0);
  f.state.claimNonce = saved.nonce; f.state.timestamp = BigInt(saved.deadline);
  await rejects(() => f.client.approveClaim(operation), 'REQUEST_EXPIRED'); assert.equal(f.counts.typed, 0);
  assert.deepEqual((await f.client.operation(operation)).claimRequest, saved);
  f.state.timestamp = 300n;
  const approved = await f.client.approveClaim(operation); assert.deepEqual(approved.claimRequest, saved);
});

test('다른 작업은 같은 beneficiary nonce 예약을 재사용하지 못하고 예약은 서명 실패에도 남는다', async () => {
  const f = workflowFixture(); await f.prepare();
  f.operator.signTypedData = async () => { throw new Error('stopped'); };
  await assert.rejects(() => f.client.approveClaim(operation));
  const body = f.methodology.evidenceBody(101, f.beneficiary, 'another-source', {});
  await f.prepare('second', '0x' + '22'.repeat(32), 'partners/101/second.json', body);
  await rejects(() => f.client.approveClaim('second'), 'NONCE_CONFLICT');
  assert.ok(!Object.hasOwn(await f.client.operation('second'), 'claimRequest'));
});

test('승인은 역할·provenance·방법론·sealed·정확 bytes·본문을 각각 검사한 후에만 요청을 만든다', async () => {
  const cases = [
    ['UNAUTHORIZED_SIGNER', f => { f.state.role = false; }],
    ['SIGNATURE_INVALID', async f => { const s = await f.journal.load(key); s.evidence.provenance.signer = f.beneficiary; await f.journal.store(key, s); }],
    ['METHODOLOGY_UNAVAILABLE', f => { f.status.active = false; }],
    ['OBJECT_UNSEALED', f => { f.objects.get(f.objectName).sealed = false; }],
    ['STORAGE_MISMATCH', f => { const o = f.objects.get(f.objectName); o.bytes = Buffer.concat([o.bytes, Buffer.from('\n')]); }],
    ['INVALID_INPUT', async f => { const s = await f.journal.load(key); s.body.ownerHash = DmrvnCrypto.ZERO_BYTES32; await f.journal.store(key, s); }],
  ];
  for (const [code, alter] of cases) {
    const f = workflowFixture(); await f.prepare(); await alter(f);
    await rejects(() => f.client.approveClaim(operation), code);
    assert.equal(f.counts.typed, 0); assert.ok(!Object.hasOwn(await f.journal.load(key), 'claimRequest'));
  }
});

test('잘못된 승인 서명은 저장하지 않고 동일 요청을 남긴다', async () => {
  const f = workflowFixture(); await f.prepare();
  const other = new Wallet('0x' + '00'.repeat(31) + '01');
  f.operator.signTypedData = async typed => { const types = { ...typed.types }; delete types.EIP712Domain; return other.signTypedData(typed.domain, types, typed.message); };
  await rejects(() => f.client.approveClaim(operation), 'SIGNATURE_INVALID');
  const state = await f.client.operation(operation); assert.ok(state.claimRequest); assert.ok(!Object.hasOwn(state, 'approved'));
});

test('요청 저장 실패 시 서명 전에 멈추며 재개 시 이미 저장된 요청을 사용한다', async () => {
  const journal = new MemoryOperationJournal(), store = journal.store.bind(journal);
  const f = workflowFixture(journal); await f.prepare(); let fail = true;
  journal.store = async (name, value) => { await store(name, value); if (name === key && value.claimRequest && fail) { fail = false; throw new DmrvnError('JOURNAL_UNAVAILABLE'); } };
  await rejects(() => f.client.approveClaim(operation), 'JOURNAL_UNAVAILABLE');
  assert.equal(f.counts.typed, 0); const request = (await journal.load(key)).claimRequest;
  assert.deepEqual((await f.client.approveClaim(operation)).claimRequest, request); assert.equal(f.counts.typed, 1);
});

test('prepare 조합은 승인까지만 진행하고 누락 작업·upload 누락·int64 deadline 초과를 거부한다', async () => {
  const f = workflowFixture();
  await rejects(() => f.client.approveClaim('missing'), 'OPERATION_NOT_PREPARED');
  const approved = await f.client.prepare(operation, f.claimId, f.beneficiary, f.objectName, f.body);
  assert.ok(approved.approvalSignature); assert.equal(f.counts.creates, 1);
  const state = await f.journal.load(key); delete state.upload; await f.journal.store(key, state);
  await rejects(() => f.client.approveClaim(operation), 'OPERATION_NOT_PREPARED');
  const g = workflowFixture(); await g.prepare(); g.state.timestamp = 9223372036854775807n;
  await assert.rejects(() => g.client.approveClaim(operation), RangeError);
  assert.equal(g.counts.typed, 0); assert.ok(!Object.hasOwn(await g.journal.load(key), 'claimRequest'));
});
