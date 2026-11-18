import test from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnError } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';
import { eventLog } from './helpers/dmrvn-events.mjs';

const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);

test('직접 거래 확인은 Claim status 1..4를 보존하며 승인/출처/거래/event를 결속하고 nonce 예약만 해제한다', async () => {
  for (let status = 1; status <= 4; status++) {
    const f = await resolutionFixture(); f.observed.claim.status = status;
    const result = await f.client.resolveSubmission(f.operation, f.hash);
    assert.equal(result.status, 'CONFIRMED'); assert.equal(result.recovered, true); assert.equal(result.claim.status, status);
    const state = await f.client.operation(f.operation);
    assert.equal(state.phase, 'SUBMITTED'); assert.equal(state.submissionStatus, 'CONFIRMED');
    assert.equal(state.chainStatus, ['NONE', 'PENDING', 'VALID', 'INVALID', 'REVOKED'][status]);
    assert.deepEqual(await f.journal.load(`claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`), DmrvnJson.copy({}));
    assert.equal((await f.journal.load('claim-id:' + f.claimId)).operationId, f.operation);
    assert.equal((await f.journal.load(`source:${f.config.deploymentId()}:101:1003:source-event`)).operationId, f.operation);
    result.receipt.status = '0x0'; result.deployment.domainVersion = '999';
    assert.equal((await f.client.operation(f.operation)).receipt.status, '0x1');
    assert.equal((await f.client.resolveSubmission(f.operation)).status, 'CONFIRMED');
    assert.equal(f.counts.typed, 1); assert.equal(f.counts.creates, 1);
  }
});

test('hash가 없으면 claim/승인 nonce 이벤트로 원래 거래를 검색하고 supplied/stored hash 변경은 거부한다', async () => {
  const f = await resolutionFixture();
  const result = await f.client.resolveSubmission(f.operation);
  assert.equal(result.txHash, f.hash);
  const search = f.observations.find(c => c.method === 'eth_getLogs').params[0];
  assert.equal(search.fromBlock, '0x64'); assert.equal(search.toBlock, '0x64');
  await rejects(() => f.client.resolveSubmission(f.operation, f.claimId), 'SUBMISSION_INPUT_CHANGED');
  await rejects(() => f.client.resolveSubmission(f.operation, 'garbage'), 'INVALID_INPUT');
});

test('Claim 없음은 receipt보다 먼저 중단하고 logs/receipt/tx 부재·확인 높이 미달은 미확정으로 유지한다', async () => {
  const cases = [
    f => { f.observed.claim.status = 0; },
    f => { f.observed.logs = []; },
    f => { f.observed.receipt = null; },
    f => { f.observed.receipt.blockNumber = '0x65'; },
    f => { f.observed.tx = null; },
  ];
  for (const mutate of cases) {
    const f = await resolutionFixture(); mutate(f);
    await rejects(() => f.client.resolveSubmission(f.operation), 'SUBMISSION_UNRESOLVED');
    assert.ok(!Object.hasOwn(await f.client.operation(f.operation), 'submissionStatus'));
    assert.equal((await f.journal.load(`claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`)).operationId, f.operation);
    if (f.observed.claim.status === 0) assert.ok(!f.observations.some(c => c.method === 'eth_getLogs' || c.method === 'eth_getTransactionReceipt'));
  }
});

test('Claim의 요청 필드·approver·위치·출처 불일치는 confirmed로 저장하지 않는다', async () => {
  const changes = [
    f => { f.observed.claim.partnerId = 102; }, f => { f.observed.claim.activityId = 3; },
    f => { f.observed.claim.methodologyId = 3; }, f => { f.observed.claim.methodologyVersion = 2; },
    f => { f.observed.claim.evidenceHash = DmrvnCrypto.ZERO_BYTES32; },
    f => { f.observed.claim.methodologyHash = DmrvnCrypto.ZERO_BYTES32; },
    f => { f.observed.claim.beneficiary = f.wallet.address; }, f => { f.observed.claim.approver = f.beneficiary; },
    f => { f.observed.claim.evidenceLocationHash = DmrvnCrypto.ZERO_BYTES32; },
    f => { f.observed.claim.evidenceLocation = { ...f.request.evidenceLocation, objectName: 'other' }; },
    f => { f.observed.claim.status = 5; },
  ];
  for (const mutate of changes) {
    const f = await resolutionFixture(); mutate(f);
    await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'SUBMISSION_INPUT_CHANGED');
    assert.ok(!Object.hasOwn(await f.client.operation(f.operation), 'submissionStatus'));
  }
  const f = await resolutionFixture(), state = await f.journal.load(f.key); state.evidence.inputs = {};
  await f.journal.store(f.key, state);
  await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'SIGNATURE_INVALID');
});

test('receipt/tx sender·target·input·value·hash·block 및 Claim event 내용이 모두 일치해야 한다', async () => {
  const changes = [
    f => { f.observed.receipt.status = '0x0'; },
    f => { f.observed.tx.hash = f.claimId; }, f => { f.observed.tx.blockHash = f.claimId; },
    f => { f.observed.receipt.to = f.forwarder; }, f => { f.observed.tx.to = f.forwarder; },
    f => { f.observed.receipt.from = f.wallet.address; }, f => { f.observed.tx.from = f.wallet.address; },
    f => { f.observed.tx.input += '00'; }, f => { f.observed.tx.value = '0x1'; },
    f => { f.observed.receipt.logs = []; },
  ];
  for (const mutate of changes) {
    const f = await resolutionFixture(); mutate(f);
    await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'SUBMISSION_INPUT_CHANGED');
  }
  for (const field of ['nonce', 'beneficiary', 'partnerId', 'activityId', 'methodologyId', 'methodologyVersion', 'methodologyHash', 'evidenceHash']) {
    const f = await resolutionFixture(), values = { ...f.request, [field]: field === 'beneficiary' ? f.wallet.address
      : field.endsWith('Hash') ? DmrvnCrypto.ZERO_BYTES32 : '2' };
    f.observed.receipt.logs = [eventLog(DmrvnAbi.CLAIM, 'MrvClaimRequested', values, f.target)];
    await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'SUBMISSION_INPUT_CHANGED');
  }
  const f = await resolutionFixture(); f.observed.receipt.blockHash = f.claimId;
  await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'SUBMISSION_UNRESOLVED');
});

test('대납 확인은 execute calldata·원래 relay·성공 Forwarder event를 요구하고 relay 예약을 해제한다', async () => {
  const f = await resolutionFixture(true);
  assert.equal((await f.client.resolveSubmission(f.operation, f.hash)).status, 'CONFIRMED');
  assert.deepEqual(await f.journal.load(`relay-nonce:${f.config.chainId}:${f.wallet.address.toLowerCase()}`), DmrvnJson.copy({}));
  for (const values of [null, { success: false }, { nonce: '0' }, { signer: f.wallet.address }]) {
    const g = await resolutionFixture(true);
    g.observed.receipt.logs = values === null ? [g.claimEvent] : [g.claimEvent, eventLog(DmrvnAbi.FORWARDER, 'ExecutedForwardRequest',
      { signer: g.forward.from, nonce: g.forward.nonce, success: true, ...values }, g.forwarder)];
    await rejects(() => g.client.resolveSubmission(g.operation, g.hash), 'SUBMISSION_INPUT_CHANGED');
  }
});

test('조회 복구는 현재 만료·역할·nonce·방법론·storage 대신 원래 승인과 배포 호환성을 사용한다', async () => {
  const f = await resolutionFixture(); f.state.timestamp = 100000n; f.state.claimNonce = '0'; f.state.role = false; f.status.active = false;
  f.state.implementation = f.second; f.state.version = '1.0.1';
  f.storage.read = f.storage.head = async () => assert.fail('복구 경로의 storage 접근');
  const result = await f.client.resolveSubmission(f.operation, f.hash);
  assert.equal(result.status, 'CONFIRMED'); assert.equal(result.deployment.implementationAddress, f.first);
  assert.equal(result.verifiedMetadata.implementationAddress, f.second);
  f.state.version = 'wrong'; await rejects(() => f.client.resolveSubmission(f.operation, f.hash), 'UNAPPROVED_IMPLEMENTATION');
});

test('예약 해제는 자기 operation만 지우고 confirmed 저장 실패 후 재조회로 정리를 재개한다', async () => {
  const f = await resolutionFixture();
  const reservation = `claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`;
  await f.journal.store(reservation, { operationId: 'another-operation' });
  await f.client.resolveSubmission(f.operation, f.hash);
  assert.equal((await f.journal.load(reservation)).operationId, 'another-operation');
  const g = await resolutionFixture(), store = g.journal.store.bind(g.journal); let fail = true;
  g.journal.store = async (name, value) => { await store(name, value); if (name === g.key && value.submissionStatus === 'CONFIRMED' && fail) { fail = false; throw new DmrvnError('JOURNAL_UNAVAILABLE'); } };
  await rejects(() => g.client.resolveSubmission(g.operation, g.hash), 'JOURNAL_UNAVAILABLE');
  assert.equal((await g.client.operation(g.operation)).submissionStatus, 'CONFIRMED');
  assert.equal((await g.client.resolveSubmission(g.operation)).status, 'CONFIRMED');
  assert.deepEqual(await g.journal.load(`claim-nonce:${g.config.deploymentId()}:${g.beneficiary}`), DmrvnJson.copy({}));
});

test('intent 누락은 준비 미완료이고 hash 없는 로그 조회의 범위 초과는 별도 오류다', async () => {
  const f = workflowFixture(); await f.prepare(); await f.client.approveClaim('operation-one');
  await rejects(() => f.client.resolveSubmission('operation-one'), 'OPERATION_NOT_PREPARED');
  const g = await resolutionFixture(); g.state.head = 100101n;
  await rejects(() => g.client.resolveSubmission(g.operation), 'REPORT_LOOKUP_RANGE');
  // 알려진 hash는 로그 범위 검색을 하지 않는다.
  assert.equal((await g.client.resolveSubmission(g.operation, g.hash)).status, 'CONFIRMED');
});
