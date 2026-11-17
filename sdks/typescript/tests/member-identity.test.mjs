import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberExternalId } from '../dist/index.js';

// 명세의 문서 계산 벡터. 실제 Privy 또는 Java 실행 결과를 뜻하지 않는다.
test('고정 회원 식별자 벡터 8개', () => {
  for (const [ns, user, partner, expected] of [
    ['service', 'member-1', undefined, 'user_B1EXwCj2_kXnlvcLNLUnUPnWCXGtw3DPW4-rIhBUkjI'],
    ['service-b', 'member-1', undefined, 'user_UraFgkp9ZaQQhs4vu3di5P3FknZYCZnT__h_Af8C0Hg'],
    ['service', 'member', 101, 'partner_6I46vlxNTwqIrAefyFYUEZ8rADsWYtIMs4d2MJPzloY'],
    ['service', 'member', 102, 'partner_K4cxwSWuKJE1w9dvDaUkNOM16Uzw_mw1fvpyxqLe-7I'],
    ['service', '101\0member', undefined, 'user_6I46vlxNTwqIrAefyFYUEZ8rADsWYtIMs4d2MJPzloY'],
    ['service', '회원-1', undefined, 'user_ppZkq_3D_8d5BaiSw-97YbC3N1eMTHvD1wn3zBmwgMA'],
    ['service', ' member ', undefined, 'user_jjK7e5alPb9rcIjBj-MJdK9Ej2hDj8A7UTLrPlAStmw'],
    ['service', 'member', 4294967295, 'partner_zavpsHtRoiSmBR-78pQf00qWHdva4iTIzUPj8pxA6Es'],
  ]) assert.equal(memberExternalId(ns, user, partner), expected);
});

test('Java 공백 판정과 입력 범위를 보존한다', () => {
  for (const user of [null, undefined, '', '\t\n\u001c\u1680\u2000\u2028\u3000']) {
    assert.throws(() => memberExternalId('service', user), TypeError);
  }
  for (const ns of ['', '한글', 'x'.repeat(65), 'a\0b', null]) {
    assert.throws(() => memberExternalId(ns, 'member'), TypeError);
  }
  for (const partner of [null, 0, -1, 1.5, NaN, Infinity, 4294967296]) {
    assert.throws(() => memberExternalId('service', 'member', partner), TypeError);
  }
  for (const user of ['\u00a0', '\u2007', '\u202f']) {
    assert.match(memberExternalId('service', user), /^user_[\w-]{43}$/);
  }
});

test('Unicode 정규화 없이 해시하고 Java의 고립 surrogate 대체를 보존한다', () => {
  assert.notEqual(memberExternalId('service', 'é'), memberExternalId('service', 'e\u0301'));
  assert.notEqual(memberExternalId('service', '😀'), memberExternalId('service', '??'));
  assert.equal(memberExternalId('service', '\ud800x\udfff'), memberExternalId('service', '?x?'));
  assert.notEqual(memberExternalId('service', 'member'), memberExternalId('Service', 'member'));
});
