import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { nativeLocks } from '../dist/internal/posix-lock.js';

const supported = ['darwin', 'linux'].includes(process.platform);
const options = { skip: supported ? false : 'POSIX OFD locks require macOS/Linux' };

test('OFD 잠금은 동일 파일의 descriptor끼리 충돌하고 무관한 close로 풀리지 않으며 소유 close로 해제된다', options, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recanet-os-lock-')), path = join(dir, 'lock'), handles = [];
  try {
    for (let i = 0; i < 3; i++) handles.push(await open(path, 'a', 0o600));
    const locks = nativeLocks();
    assert.equal(locks.tryLock(handles[0].fd), true); assert.equal(locks.tryLock(handles[1].fd), false);
    await handles[2].close(); assert.equal(locks.tryLock(handles[1].fd), false);
    locks.unlock(handles[0].fd); assert.equal(locks.tryLock(handles[1].fd), true);
    await handles[1].close(); assert.equal(locks.tryLock(handles[0].fd), true);
    locks.unlock(handles[0].fd);
  } finally { await Promise.all(handles.map(h => h.close())); await rm(dir, { recursive: true, force: true }); }
});

test('native fd 인자는 정수 범위로 제한하고 잘못된 fd 오류에 경로/OS 메시지를 노출하지 않는다', options, () => {
  const locks = nativeLocks();
  for (const value of [null, '3', -1, 0.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => locks.tryLock(value), { message: 'Journal OS lock unavailable' });
    assert.throws(() => locks.unlock(value), { message: 'Journal OS lock unavailable' });
  }
  assert.throws(() => locks.tryLock(2147483647), { message: 'Journal OS lock unavailable' });
});

test('worker isolate의 별도 descriptor도 같은 OS 잠금과 충돌한다', options, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recanet-worker-lock-')), path = join(dir, 'lock'), handle = await open(path, 'a', 0o600);
  async function probe() {
    const worker = new Worker(new URL('./helpers/os-lock-worker.mjs', import.meta.url), { workerData: path });
    const exited = once(worker, 'exit');
    const [value] = await once(worker, 'message'); await exited; return value;
  }
  try {
    assert.equal(nativeLocks().tryLock(handle.fd), true); assert.equal(await probe(), false);
    await handle.close(); assert.equal(await probe(), true);
  } finally { await handle.close(); await rm(dir, { recursive: true, force: true }); }
});

test('실제 Java FileChannel 잠금과 양방향 충돌하며 프로세스 강제 종료 시 OS가 잠금을 해제한다', options, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'recanet-java-lock-')), path = join(dir, 'lock');
  const source = fileURLToPath(new URL('./helpers/JournalLockProbe.java', import.meta.url));
  const compile = spawnSync('javac', ['-d', dir, source], { encoding: 'utf8' });
  if (compile.error?.code === 'ENOENT') { await rm(dir, { recursive: true, force: true }); t.skip('Java interoperability probe requires JDK'); return; }
  assert.equal(compile.status, 0, compile.stderr);
  const java = spawn('java', ['-cp', dir, 'JournalLockProbe', path, 'hold'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(java, 'exit'); const handle = await open(path, 'a', 0o600);
  try {
    const [ready] = await once(java.stdout, 'data'); assert.equal(ready.toString().trim(), 'LOCKED');
    assert.equal(nativeLocks().tryLock(handle.fd), false);
    java.kill('SIGKILL'); await exited;
    assert.equal(nativeLocks().tryLock(handle.fd), true);
    const attempt = spawnSync('java', ['-cp', dir, 'JournalLockProbe', path, 'try'], { encoding: 'utf8' });
    assert.equal(attempt.status, 0, attempt.stderr); assert.equal(attempt.stdout.trim(), 'BLOCKED');
    nativeLocks().unlock(handle.fd);
    const next = spawnSync('java', ['-cp', dir, 'JournalLockProbe', path, 'try'], { encoding: 'utf8' });
    assert.equal(next.status, 0, next.stderr); assert.equal(next.stdout.trim(), 'LOCKED');
  } finally { java.kill('SIGKILL'); await exited; await handle.close(); await rm(dir, { recursive: true, force: true }); }
});
