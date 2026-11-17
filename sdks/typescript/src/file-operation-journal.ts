import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { open, readFile, readdir, rename, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { bytes32, textHash } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnError } from './errors.js';
import { stateMap } from './internal/dmrvn-state.js';
import { nativeLocks } from './internal/posix-lock.js';
import type { OperationJournal } from './operation-journal.js';

interface Scope {
  owner: FileOperationJournal; path: string; parent: Scope | undefined; active: boolean;
  tail: Promise<void>; writes: Promise<void>; io: Set<Promise<unknown>>;
}
const scopes = new AsyncLocalStorage<Scope>();
const unavailable = (): DmrvnError => new DmrvnError('JOURNAL_UNAVAILABLE');
function active(scope: Scope): boolean {
  for (let current: Scope | undefined = scope; current; current = current.parent) if (!current.active) return false;
  return true;
}
async function drain(scope: Scope): Promise<void> {
  let tail: Promise<void>;
  do { tail = scope.tail; await tail; await Promise.allSettled([...scope.io]); } while (tail !== scope.tail || scope.io.size > 0);
}

/** 단일 호스트 로컬 POSIX 파일용. NFS/분산 lease 및 임의 디렉터리 변경에 대한 fencing은 제공하지 않는다. */
export class FileOperationJournal implements OperationJournal {
  #root: string;
  constructor(directory: string) {
    try {
      nativeLocks();
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.#root = realpathSync(directory); chmodSync(this.#root, 0o700);
    } catch { throw unavailable(); }
  }
  #id(key: string): string { if (typeof key !== 'string') throw unavailable(); return textHash(key).slice(2); }
  #owned(id: string): Scope {
    const current = scopes.getStore();
    if (!current || !active(current)) throw unavailable();
    for (let scope: Scope | undefined = current; scope; scope = scope.parent) {
      if (scope.owner === this && scope.path === join(this.#root, id + '.lock') && active(scope)) return scope;
    }
    throw unavailable();
  }
  async withLock<T>(key: string, action: () => T | Promise<T>): Promise<T> {
    const path = join(this.#root, this.#id(key) + '.lock'), parent = scopes.getStore();
    if (parent && !active(parent)) throw unavailable();
    for (let scope = parent; scope; scope = scope.parent) if (scope.path === path) throw unavailable();
    // 동기 Supplier처럼 중첩 형제 잠금은 차례로 실행한다. 루트의 다른 key는 독립적이다.
    let release = (): void => {};
    if (parent) {
      const previous = parent.tail;
      parent.tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
    }
    const scope: Scope = { owner: this, path, parent, active: true, tail: Promise.resolve(), writes: Promise.resolve(), io: new Set() };
    let handle: FileHandle | undefined, locked = false, failed = false, error: unknown, value: T | undefined;
    try {
      if (!active(scope)) throw unavailable();
      handle = await open(path, 'a', 0o600);
      while (!(locked = nativeLocks().tryLock(handle.fd))) {
        if (!active(scope)) throw unavailable();
        await sleep(10);
      }
      await handle.chmod(0o600);
      value = await scopes.run(scope, action);
    } catch (caught) { failed = true; error = caught; }
    finally {
      try { await drain(scope); }
      catch (caught) { if (!failed) { failed = true; error = caught; } }
      scope.active = false;
      try { if (handle && locked) nativeLocks().unlock(handle.fd); }
      catch (caught) { if (!failed) { failed = true; error = caught; } }
      try { await handle?.close(); }
      catch (caught) { if (!failed) { failed = true; error = caught; } }
      release();
    }
    if (failed) throw error instanceof DmrvnError ? error : unavailable();
    return value as T;
  }
  async load(key: string): Promise<Record<string, unknown> | null> {
    try { return stateMap(DmrvnJson.parse(await readFile(join(this.#root, this.#id(key) + '.json')))); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
      throw unavailable();
    }
  }
  async findOperationsByClaimId(claimId: string): Promise<readonly Record<string, unknown>[]> {
    const normalized = bytes32(claimId);
    const scope = this.#owned(this.#id('claim-id:' + normalized));
    try {
      const result: Record<string, unknown>[] = [];
      for (const name of await readdir(this.#root)) {
        if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
        const state = stateMap(DmrvnJson.parse(await readFile(join(this.#root, name))));
        if (typeof state.operationId === 'string' && name === this.#id('operation:' + state.operationId) + '.json'
          && normalized === String(state.claimId).toLowerCase()) result.push(state);
      }
      if (!active(scope)) throw unavailable();
      return result;
    } catch { throw unavailable(); }
  }
  async store(key: string, snapshot: Readonly<Record<string, unknown>>): Promise<void> {
    let id: string, scope: Scope, bytes: Uint8Array;
    try { id = this.#id(key); scope = this.#owned(id); bytes = DmrvnJson.bytes(stateMap(snapshot)); }
    catch { throw unavailable(); }
    const pending = scope.writes.then(() => this.#write(id, bytes, scope));
    scope.writes = pending.catch(() => {});
    scope.io.add(pending);
    void pending.then(() => scope.io.delete(pending), () => scope.io.delete(pending));
    return pending;
  }
  async #write(id: string, bytes: Uint8Array, scope: Scope): Promise<void> {
    const temp = join(this.#root, id + '.' + randomUUID() + '.tmp');
    try {
      if (!active(scope)) throw unavailable();
      const output = await open(temp, 'wx', 0o600);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          if (!active(scope)) throw unavailable();
          const written = await output.write(bytes, offset, bytes.length - offset, offset);
          if (written.bytesWritten === 0) throw unavailable();
          offset += written.bytesWritten;
        }
        await output.sync();
      } finally { await output.close(); }
      if (!active(scope)) throw unavailable();
      await rename(temp, join(this.#root, id + '.json'));
      const directory = await open(this.#root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw unavailable(); }
    finally { try { await unlink(temp); } catch {} }
  }
}
