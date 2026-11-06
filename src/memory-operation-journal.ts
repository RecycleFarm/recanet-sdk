import { AsyncLocalStorage } from 'node:async_hooks';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnError } from './errors.js';
import type { OperationJournal } from './operation-journal.js';

function copy(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = DmrvnJson.copy(value);
  if (result === null || typeof result !== 'object' || Array.isArray(result)
    || (Object.getPrototypeOf(result) !== Object.prototype && Object.getPrototypeOf(result) !== null)) throw new DmrvnError('INVALID_INPUT');
  return result as Record<string, unknown>;
}

/** 프로세스 내 휘발성 단계 상태. 디스크·다중 프로세스·재시작 복구를 보장하지 않는다. */
export class MemoryOperationJournal implements OperationJournal {
  #states = new Map<string, Record<string, unknown>>();
  #tail: Promise<void> = Promise.resolve();
  #owner = new AsyncLocalStorage<{ active: boolean; tail: Promise<void> }>();

  async #exclusive<T>(action: () => T | Promise<T>): Promise<T> {
    // 같은 monitor 소유 작업의 load/store는 대기하지 않는다.
    if (this.#owner.getStore()?.active) return action();
    return this.#locked(action);
  }

  async #locked<T>(action: () => T | Promise<T>): Promise<T> {
    const current = this.#owner.getStore();
    const parent = current?.active ? current : undefined;
    const previous = parent ? parent.tail : this.#tail;
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    if (parent) parent.tail = next;
    else this.#tail = next;
    await previous;
    const scope = { active: true, tail: Promise.resolve() };
    try {
      if (parent && !parent.active) throw new DmrvnError('JOURNAL_UNAVAILABLE');
      return await this.#owner.run(scope, action);
    }
    finally {
      // Promise.all의 조기 실패에도 나머지 자식이 실행 중일 수 있다. 자식 queue가
      // 안정적으로 비워지기 전에는 전역 monitor를 해제하지 않는다.
      let pending: Promise<void>;
      do { pending = scope.tail; await pending; } while (pending !== scope.tail);
      scope.active = false;
      release();
    }
  }

  withLock<T>(_key: string, action: () => T | Promise<T>): Promise<T> {
    // 기준 MemoryOperationJournal은 key와 무관하게 단일 monitor로 직렬화한다.
    // 자식 잠금끼리는 부모의 queue에서 직렬화하여 async fan-out도 재진입으로 겹치지 않는다.
    return this.#locked(action);
  }
  load(key: string): Promise<Record<string, unknown> | null> {
    return this.#exclusive(() => {
      const value = this.#states.get(key);
      return value === undefined ? null : copy(value);
    });
  }
  async store(key: string, snapshot: Readonly<Record<string, unknown>>): Promise<void> {
    const detached = copy(snapshot);
    return this.#exclusive(() => { this.#states.set(key, detached); });
  }
  findOperationsByClaimId(claimId: string): Promise<readonly Record<string, unknown>[]> {
    return this.#exclusive(() => Object.freeze([...this.#states.entries()]
      .filter(([key, value]) => key.startsWith('operation:') && value.claimId === claimId).map(([, value]) => copy(value))));
  }
}
