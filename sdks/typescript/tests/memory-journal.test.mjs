import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryOperationJournal } from '../dist/index.js';
import { findClaimOperations } from '../dist/internal/journal.js';

test('동시 작업을 단일 monitor로 직렬화하고 nested lock/load/store를 재진입시킨다', async () => {
  const journal = new MemoryOperationJournal();
  await journal.store('counter', { value: 0 });
  await Promise.all(Array.from({ length: 32 }, (_, i) => journal.withLock('worker-' + i, async () => {
    const current = await journal.load('counter');
    await Promise.resolve();
    await journal.withLock('nested', async () => {
      await journal.withLock('nested', () => journal.store('counter', { value: current.value + 1 }));
    });
  })));
  assert.equal((await journal.load('counter')).value, 32);
  await journal.withLock('parent', () => Promise.all(Array.from({ length: 16 }, () => journal.withLock('child', async () => {
    const value = await journal.load('counter');
    await Promise.resolve();
    await journal.store('counter', { value: value.value + 1 });
  }))));
  assert.equal((await journal.load('counter')).value, 48);
});

test('lock 밖 load/store도 현재 monitor 뒤에 대기하며 저장 입력은 호출 시점에 복사한다', async () => {
  const journal = new MemoryOperationJournal();
  let unlock;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unlock = resolve; });
  const holder = journal.withLock('holder', async () => { entered(); await gate; });
  await ready;
  const input = { nested: { value: 'captured' } };
  let stored = false;
  const pendingStore = journal.store('record', input).then(() => { stored = true; });
  const pendingLoad = journal.load('record');
  input.nested.value = 'changed';
  await Promise.resolve();
  assert.equal(stored, false);
  unlock();
  await holder;
  await pendingStore;
  assert.equal((await pendingLoad).nested.value, 'captured');
});

test('load·store·claim 검색은 독립 JSON snapshot을 반환하며 배포 전체 operation을 검색한다', async () => {
  const journal = new MemoryOperationJournal();
  const value = { operationId: 'one', claimId: 'claim', deployment: 'first', nested: { values: [1] } };
  await journal.store('operation:one', value);
  await journal.store('operation:two', { operationId: 'two', claimId: 'claim', deployment: 'second' });
  await journal.store('operation:other', { operationId: 'other', claimId: 'other-claim' });
  await journal.store('claim-id:claim', { claimId: 'claim' });
  value.nested.values[0] = 2;
  const loaded = await journal.load('operation:one');
  loaded.nested.values[0] = 3;
  assert.equal((await journal.load('operation:one')).nested.values[0], 1);
  const found = await findClaimOperations(journal, 'claim');
  assert.deepEqual(found.map(item => item.operationId), ['one', 'two']);
  assert.ok(Object.isFrozen(found));
  found[0].nested.values[0] = 4;
  assert.equal((await journal.load('operation:one')).nested.values[0], 1);
  assert.equal(await journal.load('missing'), null);
});

test('callback 실패 후에도 lock을 해제하고 원래 오류를 보존한다', async () => {
  const journal = new MemoryOperationJournal();
  const original = new Error('callback-error');
  await assert.rejects(journal.withLock('key', async () => { await Promise.resolve(); throw original; }), error => error === original);
  assert.equal(await journal.withLock('key', async () => { await journal.store('state', { ok: true }); return 7; }), 7);
  assert.equal((await journal.load('state')).ok, true);
});

test('fan-out의 조기 실패에도 실행 중인 자식이 끝나기 전에는 전역 lock을 해제하지 않는다', async () => {
  const journal = new MemoryOperationJournal();
  const events = [];
  const original = new Error('first-child-failure');
  let unlock;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { unlock = resolve; });
  let parentFailed = false;
  const parent = journal.withLock('parent', () => Promise.all([
    journal.withLock('first', async () => { throw original; }),
    journal.withLock('second', async () => {
      events.push('child-start'); entered(); await gate;
      await journal.store('state', { complete: true }); events.push('child-end');
    }),
  ]));
  const observed = parent.catch(error => { parentFailed = true; return error; });
  await ready;
  const outsider = journal.withLock('outsider', async () => {
    events.push('outsider'); assert.equal((await journal.load('state')).complete, true);
  });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(parentFailed, false);
  assert.deepEqual(events, ['child-start']);
  unlock();
  assert.equal(await observed, original);
  await outsider;
  assert.deepEqual(events, ['child-start', 'child-end', 'outsider']);
});

test('claim 검색 미지원 adapter는 닫힌 실패로 처리하고 새 메모리 인스턴스는 상태를 공유하지 않는다', async () => {
  await assert.rejects(findClaimOperations({ load() {}, store() {}, withLock() {} }, 'claim'), error => error.code === 'JOURNAL_UNAVAILABLE');
  const first = new MemoryOperationJournal();
  await first.store('operation:one', { claimId: 'claim' });
  assert.equal(await new MemoryOperationJournal().load('operation:one'), null);
  await assert.rejects(first.store('invalid', new Date()), error => error.code === 'INVALID_INPUT');
});
