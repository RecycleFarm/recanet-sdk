import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityRequest, DmrvnClient, DmrvnConfig, DmrvnProtocol, FileOperationJournal } from '../dist/index.js';

import { DmrvnAbi } from '../dist/dmrvn-abi.js';
import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { DmrvnPreflight } from '../dist/dmrvn-preflight.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';
import { resolutionFixture } from './helpers/dmrvn-resolution.mjs';
import { userActivityFixture } from './helpers/user-activity.mjs';

const vector = JSON.parse(await readFile(new URL('./fixtures/evidence-v4-pet-v3.json', import.meta.url), 'utf8'));
const code = expected => error => error.code === expected;

test('일반 Java 방법론은 초기화에 partner 전용 제약을 추가하지 않는다', () => {
  const f = workflowFixture(undefined, { petV3: true });
  const other = new DmrvnConfig({ ...f.config, partnerId: 102 });
  assert.doesNotThrow(() => new DmrvnClient(other, f.rpc, f.operator, f.storage, f.methodology));
  assert.doesNotThrow(() => new DmrvnPreflight(other, f.rpc, f.operator, f.storage, f.methodology));
  assert.equal(f.calls.length, 0); assert.equal(f.counts.messages, 0); assert.equal(f.counts.creates, 0);
});

test('v4 Evidence는 고정된 전체 canonical bytes로 저장·SEALED 재읽기하고 bodyHash와 다른 hash를 Claim에 승인한다', async () => {
  const f = workflowFixture(undefined, { petV3: true });
  // 벡터와 같은 signer 문자열 표기를 사용한다. 주소의 표기를 새 규칙으로 강제하지 않는다.
  f.operator.address = vector.signer;
  const operation = 'pet-v4-evidence';
  const saved = await f.client.prepareEvidence(operation, f.claimId, f.beneficiary, f.objectName, vector.body);
  assert.equal(saved.upload.status, 'SEALED');
  assert.equal(Buffer.from(f.objects.get(f.objectName).bytes).toString('utf8'), vector.evidenceCanonical);
  assert.equal(saved.upload.evidenceHash, vector.evidenceHash);
  assert.notEqual(saved.upload.evidenceHash, vector.bodyHash);
  const approved = await f.client.approveClaim(operation);
  assert.equal(approved.claimRequest.evidenceHash, vector.evidenceHash);
  assert.equal(approved.claimRequest.methodologyVersion, 3);
  assert.equal(approved.claimRequest.methodologyHash, f.methodology.hash());
  assert.equal(DmrvnProtocol.verifyProvenance(saved.evidence, vector.evidenceHash, f.operator.address), vector.signer);
  await f.client.prepareEvidence(operation, f.claimId, f.beneficiary, f.objectName, vector.body);
  assert.equal(f.counts.messages, 1); assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1);
});

test('확정 프로필에서 다른 방법론·과거 본문 버전은 서명·생성·작업 예약 전에 거부한다', async () => {
  for (const body of [{ ...vector.body, schemaVersion: 3 },
    { ...vector.body, methodology: { id: 2003, version: 1 } }]) {
    const f = workflowFixture(undefined, { petV3: true });
    await assert.rejects(f.client.prepareEvidence('invalid-pet', f.claimId, f.beneficiary, f.objectName, body), code('INVALID_INPUT'));
    assert.equal(f.calls.length, 0); assert.equal(f.counts.messages, 0); assert.equal(f.counts.creates, 0);
    assert.equal(await f.journal.load('operation:invalid-pet'), null);
    assert.equal(await f.journal.load('claim-id:' + f.claimId), null);
  }
});

test('v4 본문이 연결된 직접 납부와 대납은 각 calldata·sender·receipt·Claim을 확인하고 원래 요청으로만 재조회한다', async () => {
  for (const sponsored of [false, true]) {
    const f = await resolutionFixture(sponsored, { petV3: true });
    const state = await f.client.operation(f.operation);
    assert.equal(state.body.schemaVersion, 4);
    assert.equal(state.body.methodology.version, 3);
    assert.equal(state.body.inputs.petBottleCount, 3);
    const calldata = sponsored ? DmrvnAbi.FORWARDER.decodeCall('execute', f.observed.tx.input).request.data : f.observed.tx.input;
    const request = DmrvnAbi.CLAIM.decodeCall('submitClaim', calldata).request;
    assert.equal(request.methodologyVersion, 3);
    assert.equal(request.evidenceHash, DmrvnJson.hash(state.evidence));
    assert.equal(f.observed.tx.from, sponsored ? f.wallet.address.toLowerCase() : f.beneficiary);
    const confirmed = await f.client.resolveSubmission(f.operation, f.hash);
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.claim.methodologyVersion, 3);
    const counts = { ...f.counts };
    assert.equal((await f.client.resolveSubmission(f.operation)).status, 'CONFIRMED');
    assert.deepEqual(f.counts, counts);
    f.observed.claim.methodologyVersion = 1;
    await assert.rejects(f.client.resolveSubmission(f.operation), code('SUBMISSION_INPUT_CHANGED'));
  }
});

test('고수준 PET 요청은 schema4/방법론3/petBottleCount를 내부 서명·대납 거래·접수 확인까지 전달한다', async () => {
  const f = userActivityFixture(true, { petV3: true });
  const outcome = await f.client.submitActivity(f.wallets, new ActivityRequest('member', 'pet-high-level', { petBottleCount: 3 },
    { confirmationTimeoutMs: 0 }));
  assert.equal(outcome.outcome, 'CONFIRMED');
  assert.equal(outcome.confirmed.chainStatus, 'PENDING');
  const state = await f.client.operation(outcome.confirmed.operationId);
  assert.equal(state.body.schemaVersion, 4); assert.equal(state.body.methodology.version, 3);
  assert.equal(state.body.inputs.petBottleCount, 3);
  assert.equal(f.facts.submission.request.methodologyVersion, 3);
  assert.equal(f.facts.submission.request.evidenceHash, DmrvnJson.hash(state.evidence));
  assert.equal(outcome.confirmed.evidenceHash, DmrvnJson.hash(state.evidence));
  assert.equal(f.facts.walletCalls, 1); assert.equal(f.facts.userSigns, 1); assert.equal(f.facts.sends, 1);
});

test('파일 journal 재개도 v4 생성 응답 유실의 원래 서명·bytes·create hash를 유지한다',
  { skip: !['darwin', 'linux'].includes(process.platform) }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'recanet-pet-v4-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const journal = new FileOperationJournal(directory), f = workflowFixture(journal, { petV3: true });
    const create = f.storage.create;
    f.storage.create = async (...args) => { await create(...args); throw new Error('synthetic lost response'); };
    // 파일 journal은 callback의 일반 예외를 원문 없이 JOURNAL_UNAVAILABLE로 정리한다.
    await assert.rejects(f.prepare(), code('JOURNAL_UNAVAILABLE'));
    const before = await f.client.operation('operation-one'), object = f.objects.get(f.objectName);
    assert.equal(f.counts.creates, 1); assert.equal(before.createIntent, true);
    assert.equal(before.body.schemaVersion, 4); assert.equal(before.body.methodology.version, 3);
    assert.equal(Object.hasOwn(before, 'createTxHash'), false);
    f.storage.create = create;
    const reopened = new DmrvnClient(f.config, f.rpc, f.operator, f.storage, f.methodology, new FileOperationJournal(directory));
    await reopened.recoverCreateTransaction('operation-one', object.hash);
    const after = await reopened.prepareEvidence('operation-one', f.claimId, f.beneficiary, f.objectName, f.body);
    assert.equal(after.upload.status, 'SEALED'); assert.equal(after.upload.createTxHash, object.hash);
    assert.equal(after.evidence.provenance.sourceSignature, before.evidence.provenance.sourceSignature);
    assert.equal(DmrvnCrypto.hexString(object.bytes), DmrvnCrypto.hexString(DmrvnJson.bytes(after.evidence)));
    assert.equal(f.counts.messages, 1); assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1);
  });
