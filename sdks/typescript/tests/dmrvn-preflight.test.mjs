import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeclaredMethodology, DmrvnError } from '../dist/index.js';

import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { DmrvnPreflight } from '../dist/dmrvn-preflight.js';
import { chainFixture, address } from './helpers/dmrvn-chain.mjs';

function methodology(registry = () => true, explicit = true) {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = { activityId: 1, methodology: { id: 2, version: 1 }, wasmHash: DmrvnCrypto.keccak(wasm) };
  return new DeclaredMethodology(DmrvnJson.bytes(manifest), wasm, DmrvnJson.hash(manifest), registry, explicit ? 999 : undefined);
}
const operator = { address: address('a'), signMessage() { assert.fail('preflight에서 서명하지 않는다'); },
  sendTransaction() { assert.fail('preflight에서 전송하지 않는다'); } };
const storage = { address: address('b'), chainId: '5600', create() { assert.fail('preflight에서 객체를 생성하지 않는다'); },
  read() { assert.fail('preflight에서 저장소 시험을 자동 실행하지 않는다'); } };

test('preflight는 읽기 결과를 집계하고 zero balance도 조회 성공으로 본다', async () => {
  const item = chainFixture();
  const ready = new DmrvnPreflight(item.config, item.rpc, operator, storage, methodology());
  assert.equal(item.calls.length, 0);
  const result = await ready.run();
  assert.equal(result.ready, true);
  assert.equal(result.deploymentId, item.config.deploymentId());
  assert.equal(result.verifiedMetadata.verified, true);
  assert.equal(result.approver, operator.address);
  assert.equal(result.relay, operator.address);
  assert.equal(result.storageSigner, storage.address);
  assert.deepEqual(result.checks.relayBalanceWei, { ok: true, value: '0' });
  assert.equal(result.checks.greenfieldWriteRead, 'NOT_TESTED');
  assert.equal(result.checks.validatorReadAccess, 'OPERATOR_CONFIRMATION_REQUIRED');
  assert.deepEqual(Object.keys(result.checks), ['deployment', 'approverRole', 'methodology', 'evidenceContract', 'relayBalanceWei',
    'greenfieldWriteRead', 'validatorReadAccess']);
  assert.equal(item.calls.at(-1).method, 'eth_getBalance');
  assert.deepEqual(item.calls.at(-1).params, [operator.address, 'latest']);
  const roleCalls = item.calls.filter(call => call.method === 'eth_call' && call.params.at(-1) === 'latest');
  assert.equal(roleCalls.length, 2);
});

test('DmrvnError인 검사 실패는 후속 검사를 막지 않고 항목별 code로 집계한다', async () => {
  const item = chainFixture(false);
  item.state.role = false;
  let registryCalls = 0;
  const result = await new DmrvnPreflight(item.config, item.rpc, operator, storage,
    methodology(() => { registryCalls++; return false; }, false)).run();
  assert.equal(result.ready, false);
  assert.equal(result.verifiedMetadata, null);
  assert.deepEqual(result.checks.deployment, { ok: false, code: 'DEPLOYMENT_NOT_READY' });
  assert.deepEqual(result.checks.approverRole, { ok: false, code: 'UNAUTHORIZED_SIGNER' });
  assert.deepEqual(result.checks.methodology, { ok: false, code: 'METHODOLOGY_UNAVAILABLE' });
  assert.deepEqual(result.checks.evidenceContract, { ok: false, code: 'EVIDENCE_CONTRACT_UNCONFIGURED' });
  assert.equal(result.checks.relayBalanceWei.ok, true);
  assert.equal(registryCalls, 1);
  assert.equal(item.calls.filter(call => call.method === 'eth_getCode').length, 0);
  assert.equal(item.calls.at(-1).method, 'eth_getBalance');
});

test('일반 registry 오류는 전체 호출로 전파하고 전송 오류는 검사 경계대로 집계한다', async () => {
  const item = chainFixture();
  const original = new Error('registry-specific-error');
  const runner = new DmrvnPreflight(item.config, item.rpc, operator, storage, methodology(() => { throw original; }));
  await assert.rejects(runner.run(), error => error === original);
  const rpc = { async call(method, params) {
    if (method === 'eth_getBalance') throw new DmrvnError('RPC_UNAVAILABLE');
    return item.rpc.call(method, params);
  } };
  const result = await new DmrvnPreflight(item.config, rpc, operator, storage, methodology()).run();
  assert.equal(result.ready, false);
  assert.equal(result.verifiedMetadata.verified, true);
  assert.deepEqual(result.checks.relayBalanceWei, { ok: false, code: 'RPC_UNAVAILABLE' });
});

test('초기화 시 signer 주소와 Greenfield 네트워크를 확인하며 외부 요청은 하지 않는다', () => {
  const item = chainFixture();
  assert.throws(() => new DmrvnPreflight(item.config, item.rpc, operator, { ...storage, chainId: '05600' }, methodology()),
    error => error.code === 'WRONG_CHAIN');
  assert.throws(() => new DmrvnPreflight(item.config, item.rpc, { ...operator, address: 'wallet-id' }, storage, methodology()),
    error => error.code === 'INVALID_INPUT');
  assert.equal(item.calls.length, 0);
});

test('호출 취소도 항목별 경계로 반환하고 남은 순수 검사는 수행한다', async () => {
  const item = chainFixture();
  let registryCalls = 0;
  const result = await new DmrvnPreflight(item.config, item.rpc, operator, storage,
    methodology(() => { registryCalls++; return true; })).run(AbortSignal.abort());
  assert.equal(result.ready, false);
  assert.equal(result.checks.deployment.code, 'DEPLOYMENT_NOT_READY');
  assert.equal(result.checks.approverRole.code, 'INTERRUPTED');
  assert.equal(result.checks.methodology.ok, true);
  assert.equal(result.checks.evidenceContract.ok, true);
  assert.equal(result.checks.relayBalanceWei.code, 'INTERRUPTED');
  assert.equal(registryCalls, 1);
  assert.equal(item.calls.length, 0);
});
