import { deadlineTimer } from '../duration.js';
import { spawn } from 'node:child_process';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnError, isDmrvnErrorCode } from '../errors.js';
import { stateMap } from './dmrvn-state.js';

/** 단일 요청/프로세스. stdout protocol 외 stderr·원래 오류·부모 환경은 외부에 노출하지 않는다. */
export async function runGreenfieldWorker(node: string, worker: string, request: Record<string, unknown>, secret: string,
  timeoutMs: bigint, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (signal?.aborted) throw new DmrvnError('INTERRUPTED');
  try {
    const input = DmrvnJson.bytes(request);
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(node, [worker], { env: { GREENFIELD_STORAGE_PRIVATE_KEY: secret }, stdio: ['pipe', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      let length = 0, ended = false, exited = false, settled = false, exitTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        cancelTimer(); if (exitTimer) clearTimeout(exitTimer);
        signal?.removeEventListener('abort', interrupted); child.kill('SIGKILL');
      };
      const fail = (error: DmrvnError): void => { if (!settled) { settled = true; cleanup(); reject(error); } };
      const interrupted = (): void => fail(new DmrvnError('INTERRUPTED'));
      let cancelTimer = () => {};
      const finish = (): void => {
        if (settled || !ended || !exited) return;
        try {
          const result = stateMap(DmrvnJson.parse(Buffer.concat(chunks, length)));
          if (result.ok !== true) throw new DmrvnError(isDmrvnErrorCode(result.code) ? result.code : 'STORAGE_UNAVAILABLE', {
            definitelyNotBroadcast: request.op === 'create' && result.definitelyNotBroadcast === true,
            definitelyRejected: request.op === 'create' && result.definitelyRejected === true });
          const data = stateMap(result.data); settled = true; cleanup(); resolve(data);
        } catch (error) { fail(error instanceof DmrvnError ? error : new DmrvnError('STORAGE_UNAVAILABLE')); }
      };
      child.once('error', () => fail(new DmrvnError('STORAGE_UNAVAILABLE')));
      child.once('exit', () => { exited = true; finish(); });
      child.stdout.on('data', (chunk: Buffer) => {
        if (settled) return;
        length += chunk.length;
        if (length > 6 * 1024 * 1024) fail(new DmrvnError('STORAGE_UNAVAILABLE'));
        else chunks.push(chunk);
      });
      child.stdout.once('error', () => fail(new DmrvnError('STORAGE_UNAVAILABLE')));
      child.stdout.once('end', () => {
        ended = true; cancelTimer();
        if (!exited) exitTimer = setTimeout(() => fail(new DmrvnError('STORAGE_UNAVAILABLE')), 1000);
        finish();
      });
      child.stdin.once('error', () => fail(new DmrvnError('STORAGE_UNAVAILABLE')));
      signal?.addEventListener('abort', interrupted, { once: true });
      if (signal?.aborted) interrupted();
      if (!settled) child.stdin.end(input, () => {
        if (!settled && !ended) cancelTimer = deadlineTimer(timeoutMs * 1000000n, () => fail(new DmrvnError('STORAGE_UNAVAILABLE')));
      });
    });
  } catch (error) { throw error instanceof DmrvnError ? error : new DmrvnError('STORAGE_UNAVAILABLE'); }
}
