import test from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnCrypto, DmrvnError, DmrvnJson, DmrvnReader } from '../dist/index.js';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);

test('실제 독립 pending reader 관찰을 journal에 보존하고 제출 확인/nonce 예약을 변경하지 않는다', async () => {
  const f = await resolutionFixture(), reader = new DmrvnReader(f.config, f.rpc,
    { async read() { assert.fail('PENDING은 보고서 읽기 없음'); } }, DmrvnReader.defaultReportResolver('5600', 'reports'));
  const result = await f.client.readResult(f.operation, reader, undefined, null, true);
  assert.equal(result.chainStatus, 'PENDING'); assert.equal(result.observationStatus, 'LOCAL_WAIT_TIMEOUT');
  assert.equal(result.provenanceVerified, true); assert.equal(result.reportVerified, false);
  const state = await f.client.operation(f.operation);
  assert.deepEqual(state.result, DmrvnJson.copy(result)); assert.equal(state.phase, 'BROADCAST_INTENT');
  assert.ok(!Object.hasOwn(state, 'submissionStatus'));
  assert.equal((await f.journal.load(`claim-nonce:${f.config.deploymentId()}:${f.beneficiary}`)).operationId, f.operation);
  result.claim.status = 0; assert.equal((await f.client.operation(f.operation)).result.claim.status, 1);
});

test('원래 배포를 붙이고 reportError도 저장하며 fromBlock 자동 보완/외부 파일 hash 전달을 하지 않는다', async () => {
  const f = await resolutionFixture(), calls = [];
  f.state.implementation = f.second; f.state.version = '1.0.1';
  const verified = (await f.client.operation(f.operation)).verifiedMetadata;
  const error = { code: 'REPORT_READ_FAILED', retryable: true, action: 'READ_ONLY' };
  const reader = { async readResult(...args) { calls.push(args); return { deploymentId: f.config.deploymentId(), claim: f.observed.claim,
    verifiedMetadata: { ...verified, implementationAddress: f.second }, chainStatus: 'VALID', reportVerified: false, reportError: error }; } };
  const result = await f.client.readResult(f.operation, reader);
  assert.equal(calls[0][0], f.claimId); assert.equal(calls[0][1], undefined); assert.equal(calls[0][2], null); assert.equal(calls[0][4], null);
  assert.equal(result.deployment.implementationAddress, f.first); assert.equal(result.verifiedMetadata.implementationAddress, f.second);
  const state = await f.client.operation(f.operation);
  assert.deepEqual(state.result.reportError, DmrvnJson.copy(error)); assert.equal(state.verifiedMetadata.implementationAddress, f.second);
});

test('성공 보고 거래 hash는 저장/재사용하고 명시 hash는 조회에 우선 전달한다', async () => {
  const f = await resolutionFixture(), calls = [], hashes = ['0x' + '12'.repeat(32), '0x' + '34'.repeat(32)];
  const reader = { async readResult(...args) { calls.push(args); return { deploymentId: f.config.deploymentId(), claim: f.observed.claim,
    verifiedMetadata: (await f.client.operation(f.operation)).verifiedMetadata, reportVerified: true, reportTxHash: args[2] ?? hashes[0] }; } };
  await f.client.readResult(f.operation, reader, 0n);
  assert.equal((await f.client.operation(f.operation)).reportTxHash, hashes[0]);
  await f.client.readResult(f.operation, reader, null, null); assert.equal(calls[1][2], hashes[0]);
  await f.client.readResult(f.operation, reader, null, hashes[1]); assert.equal(calls[2][2], hashes[1]);
  assert.equal((await f.client.operation(f.operation)).reportTxHash, hashes[1]);
});

test('reader 배포 불일치·Evidence/approver 불일치는 관찰 결과 저장 전에 거부하고 status=0은 출처 검증을 생략한다', async () => {
  const f = await resolutionFixture();
  const reader = { async readResult() { return { deploymentId: 'other-deployment', claim: f.observed.claim }; } };
  await rejects(() => f.client.readResult(f.operation, reader), 'WRONG_CHAIN');
  assert.ok(!Object.hasOwn(await f.client.operation(f.operation), 'result'));
  reader.readResult = async () => ({ deploymentId: f.config.deploymentId(), claim: { ...f.observed.claim, evidenceHash: DmrvnCrypto.ZERO_BYTES32 } });
  await rejects(() => f.client.readResult(f.operation, reader), 'SIGNATURE_INVALID');
  reader.readResult = async () => ({ deploymentId: f.config.deploymentId(), claim: { status: 0 }, verifiedMetadata: {} });
  const result = await f.client.readResult(f.operation, reader); assert.ok(!Object.hasOwn(result, 'provenanceVerified'));
});

test('reader 배포 실패는 ready/metadata를 초기화해 저장하고 다른 오류는 그대로 전파한다', async () => {
  for (const code of ['DEPLOYMENT_NOT_READY', 'UNAPPROVED_IMPLEMENTATION', 'RPC_UNAVAILABLE']) {
    const f = await resolutionFixture(), error = new DmrvnError(code);
    const reader = { async readResult() { throw error; } };
    await assert.rejects(() => f.client.readResult(f.operation, reader), value => value === error);
    const state = await f.client.operation(f.operation);
    if (code !== 'RPC_UNAVAILABLE') {
      assert.equal(state.ready, false); assert.equal(state.deploymentError, code); assert.ok(!Object.hasOwn(state, 'verifiedMetadata'));
    } else assert.equal(state.ready, true);
    assert.ok(!Object.hasOwn(state, 'result'));
  }
});
