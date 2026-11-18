import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityRequest, DmrvnDecimal, DmrvnError } from '../dist/index.js';

import { DmrvnJson } from '../dist/dmrvn-json.js';

const invalid = error => error instanceof DmrvnError && error.code === 'INVALID_INPUT';
test('활동 요청은 기본값과 원시 회원 ID를 보존하고 inputs를 생성/조회 시 독립 복사한다', () => {
  const inputs = { nested: [1, { arbitrary: true }] }, request = new ActivityRequest(' user\u00a0 ', 'source-event', inputs);
  inputs.nested[1].arbitrary = false;
  assert.equal(request.userId, ' user\u00a0 '); assert.equal(request.sourceEventId, 'source-event');
  assert.equal(request.claimId, null); assert.equal(request.objectName, null); assert.equal(request.gas, '900000');
  assert.equal(request.confirmationTimeoutMs, 60000); assert.equal(request.pollIntervalMs, 1000);
  assert.deepEqual(request.inputs, DmrvnJson.copy({ nested: [1, { arbitrary: true }] }));
  const got = request.inputs; got.nested[0] = 2; assert.equal(request.inputs.nested[0], 1);
  assert.throws(() => { request.gas = '100000'; }, TypeError);
});
test('명시 claimId를 정규화하고 경로 검증은 호출 단계에 맡기며 수치 경계 양끝을 허용한다', () => {
  const low = new ActivityRequest('user', '_:A-0', {}, { claimId: '0x' + 'AB'.repeat(32), objectName: '../outside', gas: '100000',
    confirmationTimeoutMs: 0, pollIntervalMs: 1 });
  assert.equal(low.claimId, '0x' + 'ab'.repeat(32)); assert.equal(low.objectName, '../outside');
  assert.equal(low.confirmationTimeoutMs, 0);
  const high = new ActivityRequest('u', 's'.repeat(128), {}, { gas: '2000000', confirmationTimeoutMs: 600000, pollIntervalMs: 10000 });
  assert.equal(high.gas, '2000000');
});
test('회원·source·JSON 객체·gas·시간의 잘못된 값을 요청 생성 단계에서 거부한다', () => {
  for (const user of [null, '', '\t\u3000']) assert.throws(() => new ActivityRequest(user, 's', {}), invalid);
  for (const source of [null, '', 'with space', '한글', 's'.repeat(129)]) assert.throws(() => new ActivityRequest('u', source, {}), invalid);
  for (const inputs of [null, [], new DmrvnDecimal('1.0')]) assert.throws(() => new ActivityRequest('u', 's', inputs), invalid);
  for (const options of [null, { gas: null }, { gas: 100000 }, { gas: '0100000' }, { gas: '99999' }, { gas: '2000001' },
    { claimId: 'x' }, { objectName: 3 }, { confirmationTimeoutMs: null }, { confirmationTimeoutMs: -1 }, { confirmationTimeoutMs: 600001 },
    { pollIntervalMs: 0 }, { pollIntervalMs: 10001 }, { pollIntervalMs: NaN }]) {
    assert.throws(() => new ActivityRequest('u', 's', {}, options), invalid);
  }
});
