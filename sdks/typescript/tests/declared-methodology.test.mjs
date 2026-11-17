import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeclaredMethodology, DmrvnCrypto, DmrvnDecimal, DmrvnJson, DmrvnProtocol } from '../dist/index.js';

const beneficiary = '0x' + '11'.repeat(20);
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
function fixture(extra = {}, registry = () => true, schema = 999) {
  const manifest = { activityId: 1003, methodology: { id: 2003, version: 1 }, wasmHash: DmrvnCrypto.keccak(wasm),
    evidenceSchema: { inputs: 'not-selected-by-sdk' }, ...extra };
  const hash = DmrvnJson.hash(manifest);
  const bytes = DmrvnJson.bytes(manifest);
  const methodology = new DeclaredMethodology(bytes, wasm, hash, registry, schema);
  return { methodology, manifest, hash, bytes };
}
const code = expected => error => { assert.equal(error.code, expected); return true; };

test('manifest/WASM commitment와 uint32를 검사하고 registry 조회는 명시적으로 수행한다', async () => {
  let calls = 0;
  let captured;
  const item = fixture({}, async (...args) => { calls++; captured = args; return true; });
  assert.equal(calls, 0);
  assert.equal(item.methodology.hash(), item.hash);
  assert.equal(item.methodology.activityId(), 1003);
  assert.equal(item.methodology.id(), 2003);
  assert.equal(item.methodology.version(), 1);
  item.bytes.fill(0);
  item.manifest.methodology.id = 999;
  assert.equal(item.methodology.id(), 2003);
  await item.methodology.verifyActive();
  assert.equal(calls, 1);
  assert.deepEqual(captured, [1003, 2003, 1, item.hash]);
  const inactive = fixture({}, () => false);
  await assert.rejects(inactive.methodology.verifyActive(), code('METHODOLOGY_UNAVAILABLE'));
});

test('hash/WASM 불일치·대문자 wasmHash·잘못된 manifest 수치·버전을 거부한다', () => {
  const item = fixture();
  assert.throws(() => new DeclaredMethodology(item.bytes, wasm, DmrvnCrypto.ZERO_BYTES32, () => true, 999), code('METHODOLOGY_UNAVAILABLE'));
  assert.throws(() => fixture({ wasmHash: DmrvnCrypto.keccak(wasm).toUpperCase() }), code('METHODOLOGY_UNAVAILABLE'));
  assert.throws(() => new DeclaredMethodology(item.bytes, new Uint8Array([1]), item.hash, () => true, 999), code('METHODOLOGY_UNAVAILABLE'));
  for (const activityId of [-1, 4294967296]) {
    assert.throws(() => fixture({ activityId }), code('INVALID_INPUT'));
  }
  const decimalManifest = Buffer.from(JSON.stringify(item.manifest).replace('"activityId":1003', '"activityId":1.0'));
  assert.throws(() => new DeclaredMethodology(decimalManifest, wasm,
    DmrvnJson.hash({ ...item.manifest, activityId: 1 }), () => true, 999), code('INVALID_INPUT'));
  for (const schema of [0, -1, 1.5, 2147483648]) assert.throws(() => fixture({}, () => true, schema), code('INVALID_INPUT'));
  const zero = fixture({ activityId: 0, methodology: { id: 0, version: 0 } });
  assert.equal(zero.methodology.activityId(), 0);
});

test('명시하지 않은 과거 버전은 고수준 계약으로 인정하지 않는다', () => {
  const item = fixture();
  const legacy = new DeclaredMethodology(item.bytes, wasm, item.hash, () => true);
  assert.throws(() => legacy.requireExplicitEvidenceVersion(), code('EVIDENCE_CONTRACT_UNCONFIGURED'));
  assert.doesNotThrow(() => item.methodology.requireExplicitEvidenceVersion());
});

test('Evidence 본문은 정확히 7개 키와 ownerHash를 만들고 inputs를 해석하지 않고 복사한다', () => {
  const { methodology } = fixture();
  const inputs = { arbitraryPartnerInput: { values: [3, 'kg', true] } };
  const body = methodology.evidenceBody(101, beneficiary, 'test:event-1', inputs);
  assert.deepEqual(Object.keys(body).sort(), ['activityId', 'inputs', 'methodology', 'partnerId', 'schemaVersion', 'source', 'sourceEventId']);
  assert.equal(body.schemaVersion, 999); // 시험 전용 명시 버전. 검증자 수용 증거가 아니다.
  assert.equal(body.partnerId, 101);
  assert.equal(body.activityId, 1003);
  assert.equal(body.source.ownerHash, DmrvnProtocol.ownerHash(beneficiary));
  assert.equal(Object.hasOwn(body.source, 'kind'), false);
  inputs.arbitraryPartnerInput.values[0] = 99;
  assert.equal(body.inputs.arbitraryPartnerInput.values[0], 3);
  methodology.validate({ ...body, schemaVersion: '999', partnerId: '101', activityId: '1003' }, 101, beneficiary);
  for (const changed of [{ ...body, additional: true }, { ...body, methodology: { ...body.methodology, id: '2003' } },
    { ...body, source: { ...body.source, kind: 'old' } }, { ...body, sourceEventId: 'bad event' }, { ...body, inputs: [] },
    { ...body, inputs: new DmrvnDecimal('1.5') }]) {
    assert.throws(() => methodology.validate(changed, 101, beneficiary), code('INVALID_INPUT'));
  }
  assert.throws(() => methodology.evidenceBody(101, beneficiary, 'event', new DmrvnDecimal('1.5')), code('INVALID_INPUT'));
});

test('본문의 1 MiB 정확 경계와 source event 입력 제약을 검사한다', () => {
  const { methodology } = fixture();
  const empty = methodology.evidenceBody(101, beneficiary, 'event', { padding: '' });
  const padding = 'x'.repeat(1048576 - DmrvnJson.bytes(empty).length);
  const exact = methodology.evidenceBody(101, beneficiary, 'event', { padding });
  assert.equal(DmrvnJson.bytes(exact).length, 1048576);
  assert.throws(() => methodology.evidenceBody(101, beneficiary, 'event', { padding: padding + 'x' }), code('INVALID_INPUT'));
  for (const event of ['', 'x'.repeat(129), 'event/name', null]) {
    assert.throws(() => methodology.evidenceBody(101, beneficiary, event, {}), code('INVALID_INPUT'));
  }
});
