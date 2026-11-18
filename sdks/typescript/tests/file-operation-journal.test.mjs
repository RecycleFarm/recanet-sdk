import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DmrvnClient, DmrvnError, FileOperationJournal } from '../dist/index.js';

import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';
import { DmrvnJson } from '../dist/dmrvn-json.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';

const supported = ['darwin', 'linux'].includes(process.platform), options = { skip: !supported, timeout: 15000 };
const rejects = (fn, code = 'JOURNAL_UNAVAILABLE') => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);
const name = key => DmrvnCrypto.textHash(key).slice(2) + '.json';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recanet-file-journal-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return { dir, journal: new FileOperationJournal(dir) };
}
function child(directory, mode, count = 0) {
  const process = fork(new URL('./helpers/file-journal-child.mjs', import.meta.url), [directory, mode, String(count)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = ''; process.stderr.on('data', bytes => { stderr += bytes; });
  const exited = once(process, 'exit').then(([code, signal]) => ({ code, signal, stderr }));
  return { process, exited };
}

test('파일 journal은 Java 이름/canonical JSON·0700/0600과 재생성 후 독립 snapshot을 보존한다', options, async t => {
  const { dir, journal } = await fixture(t), key = 'operation:한글', input = { operationId: '한글', nested: { value: 3 } };
  assert.equal(await journal.load(key), null);
  await rejects(() => journal.store(key, input));
  await journal.withLock(key, () => journal.store(key, input)); input.nested.value = 4;
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dir, name(key)))).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, name(key).replace('.json', '.lock')))).mode & 0o777, 0o600);
  assert.equal((await readFile(join(dir, name(key)), 'utf8')), DmrvnJson.canonical({ operationId: '한글', nested: { value: 3 } }));
  const reopened = new FileOperationJournal(dir), got = await reopened.load(key); got.nested.value = 5;
  assert.equal((await reopened.load(key)).nested.value, 3);
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.tmp')));
});

test('동일 key 동시 호출·다른 인스턴스/symlink 경로도 OS 잠금으로 같은 counter를 직렬화한다', options, async t => {
  const { dir, journal } = await fixture(t), alias = dir + '-alias'; await symlink(dir, alias);
  t.after(() => rm(alias, { force: true }));
  const other = new FileOperationJournal(alias); let entered = 0;
  await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? journal : other).withLock('counter', async () => {
    assert.equal(++entered, 1); const state = await journal.load('counter') ?? { value: 0 };
    const owner = i % 2 ? journal : other; await owner.store('counter', { value: state.value + 1 }); --entered;
  })));
  assert.equal((await journal.load('counter')).value, 24);
});

test('중첩 다른 key·부모 store와 형제 fan-out을 지원하고 같은 key 재진입/다른 인스턴스 재진입은 닫힌 실패다', options, async t => {
  const { dir, journal } = await fixture(t), other = new FileOperationJournal(dir);
  await journal.withLock('parent', async () => {
    await rejects(() => journal.withLock('parent', () => {}));
    await rejects(() => other.withLock('parent', () => {}));
    await rejects(() => other.store('parent', {}));
    await Promise.all(Array.from({ length: 12 }, (_, i) => journal.withLock('child-' + i, async () => {
      await journal.store('parent', { last: i }); await journal.store('child-' + i, { i });
    })));
  });
  assert.equal((await journal.load('parent')).last, 11);
});

test('Promise.all 조기 실패에도 늦은 자식과 시작한 store가 끝난 뒤 부모 잠금을 해제한다', options, async t => {
  const { dir, journal } = await fixture(t), observer = new FileOperationJournal(dir);
  let start, release; const started = new Promise(resolve => { start = resolve; });
  const held = journal.withLock('parent', async () => {
    const failure = journal.withLock('fail', () => { throw new DmrvnError('RPC_UNAVAILABLE'); });
    const slow = journal.withLock('slow', async () => { start(); await new Promise(resolve => { release = resolve; }); await journal.store('parent', { complete: true }); });
    await Promise.all([failure, slow]);
  });
  const failure = rejects(() => held, 'RPC_UNAVAILABLE'); await started;
  let outside = false; const waiting = observer.withLock('parent', async () => { outside = true; assert.equal((await observer.load('parent')).complete, true); });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(outside, false); release(); await failure; await waiting;
  let pending;
  await journal.withLock('pending', () => { pending = journal.store('pending', { payload: 'x'.repeat(1048576) }); });
  await pending; assert.equal((await observer.load('pending')).payload.length, 1048576);
});

test('호출 시점 store snapshot과 호출 순서를 보존하고 잠금 scope 밖으로 유출된 쓰기를 거부한다', options, async t => {
  const { journal } = await fixture(t), snapshot = { value: { nested: 1 } }; let late;
  await journal.withLock('state', async () => {
    const pending = journal.store('state', snapshot); snapshot.value.nested = 2; await pending;
    assert.equal((await journal.load('state')).value.nested, 1);
    await Promise.all([journal.store('state', { payload: 'x'.repeat(1048576) }), journal.store('state', { last: true })]);
    late = () => journal.store('state', {});
  });
  assert.equal((await journal.load('state')).last, true); await rejects(late);
});

test('claim 검색은 전역 예약 잠금을 요구하고 파일명 결속·배포 전체·대소문자를 검사하며 손상 파일에 닫힌 실패다', options, async t => {
  const { dir, journal } = await fixture(t), id = '0x' + 'ab'.repeat(32);
  await rejects(() => journal.findOperationsByClaimId(id));
  for (const [key, state] of [['operation:one', { operationId: 'one', claimId: id.toUpperCase(), deploymentId: 'first' }],
    ['operation:two', { operationId: 'two', claimId: id, deploymentId: 'second' }], ['other', { operationId: 'fake', claimId: id }]]) {
    await journal.withLock(key, () => journal.store(key, state));
  }
  await writeFile(join(dir, 'ignored.tmp'), 'broken');
  await journal.withLock('claim-id:' + id, async () => {
    const states = await journal.findOperationsByClaimId(id); assert.deepEqual(states.map(s => s.operationId).sort(), ['one', 'two']);
    states[0].operationId = 'changed'; assert.equal((await journal.findOperationsByClaimId(id)).length, 2);
  });
  await writeFile(join(dir, name('corrupt')), '{broken');
  await rejects(() => journal.withLock('claim-id:' + id, () => journal.findOperationsByClaimId(id)));
  assert.equal(await journal.load('does-not-match'), null);
  await rejects(() => journal.load('corrupt'));
});

test('다중 프로세스 read-modify-store와 보유 프로세스 SIGKILL 후 재획득이 실제 파일에서 동작한다', options, async t => {
  const { dir, journal } = await fixture(t), workers = Array.from({ length: 3 }, () => child(dir, 'increment', 12));
  for (const worker of workers) t.after(() => worker.process.kill('SIGKILL'));
  for (const worker of workers) { const result = await worker.exited; assert.equal(result.code, 0, result.stderr); }
  assert.equal((await journal.load('counter')).value, 36);
  const holder = child(dir, 'hold'); t.after(() => holder.process.kill('SIGKILL'));
  await once(holder.process, 'message'); let acquired = false;
  const pending = journal.withLock('counter', async () => { acquired = true; await journal.store('counter', { value: 37 }); });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(acquired, false);
  holder.process.kill('SIGKILL'); await holder.exited; await pending; assert.equal((await journal.load('counter')).value, 37);
});

test('교체 도중 프로세스를 강제 종료해도 JSON은 이전 또는 새 완성 snapshot이며 임시 파일은 검색에서 제외한다', options, async t => {
  const { dir, journal } = await fixture(t);
  await journal.withLock('snapshot', () => journal.store('snapshot', { version: 'old' }));
  const worker = child(dir, 'replace'); t.after(() => worker.process.kill('SIGKILL'));
  while (worker.process.exitCode === null && worker.process.signalCode === null) {
    if ((await readdir(dir)).some(file => file.endsWith('.tmp'))) { worker.process.kill('SIGKILL'); break; }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  const result = await worker.exited; assert.equal(result.signal, 'SIGKILL');
  const state = await journal.load('snapshot'); assert.ok(['old', 'new'].includes(state.version));
  await journal.withLock('snapshot', () => journal.store('snapshot', { recovered: true }));
  assert.equal((await journal.load('snapshot')).recovered, true);
});

test('실제 파일 journal을 재생성한 Evidence 복구도 원래 서명·create hash로 재개한다', options, async t => {
  const { dir, journal } = await fixture(t), f = workflowFixture(journal), create = f.storage.create;
  f.storage.create = async (...args) => { await create(...args); throw new DmrvnError('STORAGE_CREATE_UNRESOLVED'); };
  await rejects(f.prepare, 'STORAGE_CREATE_UNRESOLVED');
  const reopened = new FileOperationJournal(dir), client = new DmrvnClient(f.config, f.rpc, f.operator, f.storage, f.methodology, reopened);
  const hash = f.objects.get(f.objectName).hash;
  await client.recoverCreateTransaction('operation-one', hash);
  const result = await client.prepareEvidence('operation-one', f.claimId, f.beneficiary, f.objectName, f.body);
  assert.equal(result.upload.status, 'SEALED'); assert.equal(result.createTxHash, hash); assert.equal(f.counts.messages, 1); assert.equal(f.counts.creates, 1);
});
