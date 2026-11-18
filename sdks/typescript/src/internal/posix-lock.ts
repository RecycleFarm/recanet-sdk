import { createRequire } from 'node:module';
import { DmrvnError } from '../errors.js';

interface NativeLocks { tryLock(fd: number): boolean; unlock(fd: number): void }
let binding: NativeLocks | undefined;
/** Lazy load: native journal availability does not change the pure/HTTP SDK's imports. */
export function nativeLocks(): NativeLocks {
  try {
    if (binding === undefined) {
      const loaded: unknown = createRequire(import.meta.url)(`../../prebuilds/${process.platform}-${process.arch}/posix-lock.node`);
      if (!loaded || typeof loaded !== 'object' || !('tryLock' in loaded) || typeof loaded.tryLock !== 'function'
        || !('unlock' in loaded) || typeof loaded.unlock !== 'function') throw new Error();
      binding = loaded as NativeLocks;
    }
    return binding;
  } catch { throw new DmrvnError('JOURNAL_UNAVAILABLE'); }
}
