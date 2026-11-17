import test from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnError, DmrvnReader } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { reportFixture } from './helpers/dmrvn-report.mjs';

const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
const read = (f, hash = f.hash, from = null, expected = null) => f.client.readResult(f.id, from, hash, false, expected);

test('독립 reader는 confirmedHead의 배포/Claim과 성공 보고 거래·파일을 검증한다', async () => {
  const f = reportFixture(), result = await read(f, f.hash, null, f.pet.reportFileHash);
  assert.equal(result.chainStatus, 'VALID'); assert.equal(result.observationStatus, 'FINALIZED'); assert.equal(result.taskStatus, 'UNKNOWN');
  assert.equal(result.observedBlock, 105n); assert.equal(result.verifiedMetadata.observedBlock, 105n);
  assert.equal(result.reportVerified, true); assert.equal(result.reportTxHash, f.hash); assert.equal(result.outputs.estimated_co2e.value, '60');
  assert.equal(result.fileHashVerification, 'MATCHED_EXTERNAL_COMMITMENT'); assert.equal(result.metadataIndependentlyVerified, false);
  assert.equal(f.counts.reads, 1); assert.equal(f.counts.resolves, 1);
  assert.equal(result.reportPointer.objectName, 'dmrvn/v4/reports/' + f.pet.reportHash.slice(2) + '.json');
  const claimCall = f.reportCalls.find(c => c.method === 'eth_call' && c.params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0, 10)));
  assert.equal(claimCall.params[1], '0x69'); assert.ok(!f.reportCalls.some(c => c.method.startsWith('eth_send')));
});

test('NONE/PENDING/REVOKED는 보고서를 읽지 않고 로컬 timeout을 task 만료로 바꾸지 않는다', async () => {
  for (const [status, chainStatus, observationStatus, timedOut] of [[0, 'NONE', 'NOT_FINALIZED', false], [1, 'PENDING', 'WAITING', false],
    [1, 'PENDING', 'LOCAL_WAIT_TIMEOUT', true], [4, 'REVOKED', 'NOT_FINALIZED', true]]) {
    const f = reportFixture(); f.observed.stored.status = status;
    const result = await f.client.readResult(f.id, -999n, 'bad hash ignored', timedOut, 'bad commitment ignored');
    assert.equal(result.chainStatus, chainStatus); assert.equal(result.observationStatus, observationStatus); assert.equal(result.taskStatus, 'UNKNOWN');
    assert.equal(result.reportVerified, false); assert.equal(f.counts.reads, 0); assert.equal(f.counts.resolves, 0);
    assert.ok(!Object.hasOwn(result, 'reportError'));
  }
});

test('hash 없는 조회는 claimId/reportHash 이벤트 검색과 명시 fromBlock을 요구한다', async () => {
  const f = reportFixture();
  const missing = await read(f, null); assert.equal(missing.reportError.code, 'REPORT_LOOKUP_RANGE');
  const result = await read(f, null, 0n); assert.equal(result.reportVerified, true);
  const filter = f.reportCalls.find(c => c.method === 'eth_getLogs').params[0];
  assert.equal(filter.fromBlock, '0x0'); assert.equal(filter.toBlock, '0x69');
  f.observed.logs = []; const notFound = await read(f, null, 0n);
  assert.equal(notFound.reportError.code, 'REPORT_TX_NOT_FOUND'); assert.equal(notFound.reportError.retryable, true);
});

test('보고서 오류는 체인 VALID/FINALIZED를 보존하고 성공 pointer/receipt/hash를 추가하지 않는다', async () => {
  const cases = [
    ['REPORT_TX_NOT_FOUND', f => { f.observed.receipt = null; }],
    ['REPORT_TX_NOT_FOUND', f => { f.observed.tx = null; }],
    ['REPORT_MISMATCH', f => { f.observed.receipt.status = '0x0'; }],
    ['SUBMISSION_UNRESOLVED', f => { f.observed.receipt.blockHash = DmrvnCrypto.ZERO_BYTES32; }],
    ['REPORT_MISMATCH', f => { f.observed.tx.hash = DmrvnCrypto.ZERO_BYTES32; }],
    ['REPORT_MISMATCH', f => { f.observed.receipt.logs = []; }],
    ['REPORT_MISMATCH', f => { f.observed.tx.input += '00'; }],
    ['REPORT_MISMATCH', f => { f.observed.resolveError = new Error('secret'); }],
    ['STORAGE_UNAVAILABLE', f => { f.observed.resolveError = new DmrvnError('STORAGE_UNAVAILABLE'); }],
    ['REPORT_READ_FAILED', f => { f.observed.readError = new DmrvnError('STORAGE_ACCESS_DENIED'); }],
    ['REPORT_READ_FAILED', f => { f.observed.readError = new DmrvnError('INTERRUPTED'); }],
    ['REPORT_READ_FAILED', f => { f.observed.bytes = null; }],
  ];
  for (const [code, change] of cases) {
    const f = reportFixture(); change(f); const result = await read(f);
    assert.equal(result.chainStatus, 'VALID'); assert.equal(result.observationStatus, 'FINALIZED'); assert.equal(result.reportVerified, false);
    assert.equal(result.reportError.code, code); assert.equal(result.reportError.action, 'READ_ONLY');
    assert.ok(!Object.hasOwn(result, 'reportPointer')); assert.ok(!Object.hasOwn(result, 'reportTxHash')); assert.ok(!Object.hasOwn(result, 'receipt'));
    assert.ok(!String(result.reportError).includes('secret'));
  }
});

test('4 MiB 원시 파일 경계를 적용하고 reader에는 위치 사본을 전달한다', async () => {
  const f = reportFixture(), bytes = Buffer.alloc(4 * 1024 * 1024, 32); bytes.set(f.observed.bytes); f.observed.bytes = bytes;
  const result = await read(f); assert.equal(result.reportVerified, true); assert.equal(result.fileHash, DmrvnCrypto.keccak(bytes));
  f.observed.bytes = Buffer.concat([bytes, Buffer.from(' ')]);
  assert.equal((await read(f)).reportError.code, 'REPORT_READ_FAILED');
  f.observed.bytes = DmrvnJson.bytes(f.pet.report);
  f.reader.read = async location => { location.objectName = 'changed'; return f.observed.bytes; };
  const detached = await read(f); assert.ok(detached.reportPointer.objectName.startsWith('dmrvn/v4/reports/'));
});

test('잘못된 chain status/배포/초기 RPC/입력은 reportError 포장 전에 전파한다', async () => {
  const f = reportFixture(); f.observed.stored.status = 5;
  await rejects(() => read(f), 'RPC_UNAVAILABLE');
  f.observed.stored.status = 2; f.state.version = 'wrong'; await rejects(() => read(f), 'UNAPPROVED_IMPLEMENTATION');
  await rejects(() => f.client.readResult('invalid'), 'INVALID_INPUT');
  const controller = new AbortController(); controller.abort();
  await rejects(() => f.client.readResult(f.id, null, null, false, null, controller.signal), 'INTERRUPTED');
});

test('출처 검증은 private Evidence hash/approver와 대조하되 원시 canonical bytes·신규 schema·현재 역할을 요구하지 않는다', async () => {
  const f = reportFixture(); f.state.role = false;
  const bytes = Buffer.from(JSON.stringify(f.pet.evidence, null, 2) + '\n');
  assert.equal(await f.client.verifyEvidenceProvenance(f.id, bytes), f.pet.expectedFinalClaim.approver.toLowerCase());
  f.observed.stored.status = 0;
  await rejects(() => f.client.verifyEvidenceProvenance(f.id, bytes), 'OPERATION_NOT_PREPARED');
  f.observed.stored.status = 2;
  for (const invalid of [null, new Uint8Array(1048577)]) await rejects(() => f.client.verifyEvidenceProvenance(f.id, invalid), 'INVALID_INPUT');
  const changed = DmrvnJson.copy(f.pet.evidence); changed.inputs = {};
  await rejects(() => f.client.verifyEvidenceProvenance(f.id, DmrvnJson.bytes(changed)), 'SIGNATURE_INVALID');
});

test('기본 resolver는 v4 경로·소문자 hash를 만들며 네트워크/버킷 실측을 수행하지 않는다', () => {
  const resolver = DmrvnReader.defaultReportResolver('', '');
  assert.deepEqual(resolver.resolve('0x' + 'AB'.repeat(32)), { storageType: 1, chainId: '', bucketName: '',
    objectName: 'dmrvn/v4/reports/' + 'ab'.repeat(32) + '.json' });
  assert.throws(() => resolver.resolve('invalid'), error => error.code === 'INVALID_INPUT');
});
