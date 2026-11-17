import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { DeclaredMethodology, DmrvnProtocol } from '../dist/index.js';

import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { petV3Methodology } from './helpers/evidence-v4.mjs';

const vector = JSON.parse(await readFile(new URL('./fixtures/evidence-v4-pet-v3.json', import.meta.url), 'utf8'));
const code = expected => error => error.code === expected;

test('확정 PET v3 factory는 Evidence 4와 방법론 2003/3을 구분하며 registry에 정확한 식별값을 전달한다', async () => {
  const calls = [], f = petV3Methodology(async (...args) => { calls.push(args); return true; });
  assert.deepEqual(calls, []);
  assert.equal(f.methodology.version(), 3);
  assert.doesNotThrow(() => f.methodology.requireExplicitEvidenceVersion());
  assert.equal(f.methodology.evidenceBody(101, vector.beneficiary, 'event', { petBottleCount: 3 }).schemaVersion, 4);
  await f.methodology.verifyActive();
  assert.deepEqual(calls, [[1003, 2003, 3, f.hash]]);
});

test('일반 Java 방법론은 활동·방법론을 추론하지 않고 hash/WASM 결속을 검사한다', () => {
  const f = petV3Methodology();
  for (const changes of [{ methodology: { id: 2003, version: 1 } }, { methodology: { id: 2004, version: 3 } }, { activityId: 1004 }]) {
    assert.doesNotThrow(() => petV3Methodology(() => true, changes));
  }
  assert.throws(() => new DeclaredMethodology(f.bytes, f.wasm, DeclaredMethodology.PET_HASH, () => true, 4), code('METHODOLOGY_UNAVAILABLE'));
  assert.throws(() => new DeclaredMethodology(f.bytes, new Uint8Array([1]), f.hash, () => true, 4), code('METHODOLOGY_UNAVAILABLE'));
});

test('확정 본문의 필드·canonical UTF8·bodyHash는 수작업 정렬 JSON의 고정 벡터와 일치한다', () => {
  const { methodology } = petV3Methodology();
  const body = methodology.evidenceBody(101, vector.beneficiary, vector.body.sourceEventId, { petBottleCount: 3 });
  assert.equal(DmrvnJson.canonical(body), vector.bodyCanonical);
  assert.deepEqual(Buffer.from(DmrvnJson.bytes(body)), Buffer.from(vector.bodyCanonical, 'utf8'));
  assert.equal(DmrvnJson.hash(body), vector.bodyHash);
  assert.deepEqual(Object.keys(body).sort(), Object.keys(vector.body).sort());
  assert.equal(Object.hasOwn(body.source, 'kind'), false);
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  reordered.methodology = { version: 3, id: 2003 };
  assert.equal(DmrvnJson.canonical(reordered), vector.bodyCanonical);
});

test('일반 Java 경로는 partner101이나 petBottleCount-only 제약을 추가하지 않는다', () => {
  const { methodology } = petV3Methodology();
  for (const inputs of [{}, { bottleCount: 3 }, { petBottleCount: 3, extra: true }]) {
    assert.equal(DmrvnJson.canonical(methodology.evidenceBody(102, vector.beneficiary, 'event', inputs).inputs), DmrvnJson.canonical(inputs));
  }
});

test('출처 서명은 본문 hash의 EIP191이며 전체 Evidence hash는 provenance와 서명을 포함한다', async () => {
  // 공개 시험키 2. 운영 키가 아니다.
  const signer = new Wallet('0x' + '00'.repeat(31) + '02');
  assert.equal(await signer.signMessage(vector.message), vector.sourceSignature);
  assert.equal(vector.message, 'DMRVN v4 source:' + vector.bodyHash);
  assert.equal(DmrvnCrypto.recover(DmrvnCrypto.messageDigest(vector.message), vector.sourceSignature), vector.signer);
  assert.equal(DmrvnJson.canonical(vector.evidence), vector.evidenceCanonical);
  assert.equal(DmrvnJson.hash(vector.evidence), vector.evidenceHash);
  assert.notEqual(vector.bodyHash, vector.evidenceHash);
  assert.equal(DmrvnProtocol.verifyProvenance(vector.evidence, vector.evidenceHash, vector.signer), vector.signer);
  const extraProvenance = { ...vector.evidence, provenance: { ...vector.evidence.provenance, note: 'not in signed body' } };
  assert.notEqual(DmrvnJson.hash(extraProvenance), vector.evidenceHash);
  assert.equal(DmrvnProtocol.verifyProvenance(extraProvenance, DmrvnJson.hash(extraProvenance), vector.signer), vector.signer);
  const changed = { ...vector.evidence, inputs: { petBottleCount: 4 } };
  assert.throws(() => DmrvnProtocol.verifyProvenance(changed, vector.evidenceHash, vector.signer), code('SIGNATURE_INVALID'));
  assert.throws(() => DmrvnProtocol.verifyProvenance(changed, DmrvnJson.hash(changed), vector.signer), code('SIGNATURE_INVALID'));
});
