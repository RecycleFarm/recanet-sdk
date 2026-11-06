import { PrivyApiError, type PrivyApiErrorCode } from '../errors.js';
import type { SignedRequest } from './authorization.js';

export interface HttpSettings {
  readonly origin: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly timeoutMs: number;
  readonly fetch: typeof globalThis.fetch;
}

const MAX_BODY = 4 * 1024 * 1024;

function retryAfter(value: string | null): bigint | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  // fetch Headers는 반복 필드를 쉼표로 합친다. 첫 값만 사용하되 HTTP 날짜의
  // 요일 뒤 쉼표는 필드 경계로 취급하지 않는다.
  const integer = /^([+-]?\d+)\s*(?:,|$)/.exec(trimmed)?.[1];
  if (integer !== undefined) {
    const seconds = BigInt(integer);
    if (seconds >= -(1n << 63n) && seconds < (1n << 63n)) {
      return seconds >= 0n ? seconds * 1000n : undefined;
    }
  }
  const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})(?=\s*(?:,|$))/.exec(trimmed)?.[0];
  if (httpDate === undefined) return undefined;
  const date = Date.parse(httpDate);
  return Number.isFinite(date) ? BigInt(Math.max(0, date - Date.now())) : undefined;
}

function statusCode(status: number): PrivyApiErrorCode {
  if (status === 401) return 'INVALID_CREDENTIALS';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  return status >= 500 ? 'UNAVAILABLE' : 'INVALID_RESPONSE';
}

/** 네트워크 시작부터 body 완료까지 제한한다. 자동 재시도·redirect가 없다. */
export async function requestJson(settings: HttpSettings, path: string,
  method: 'GET' | 'POST', body?: unknown, signal?: AbortSignal, expectedStatus = 200,
  signed?: SignedRequest): Promise<unknown> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: PrivyApiError) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = (code: 'UNAVAILABLE' | 'INTERRUPTED') => {
    controller.abort();
    void reader?.cancel().catch(() => {});
    rejectStop(new PrivyApiError(code));
  };
  const onAbort = () => stop('INTERRUPTED');
  // Node timer의 32비트 한도를 넘는 설정도 즉시 1ms로 바뀌지 않도록 분할한다.
  const deadline = performance.now() + settings.timeoutMs;
  const schedule = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) stop('UNAVAILABLE');
    else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  else schedule();

  const execute = async () => {
    if (controller.signal.aborted) throw new PrivyApiError('INTERRUPTED');
    const headers: Record<string, string> = {
      authorization: 'Basic ' + Buffer.from(`${settings.appId}:${settings.appSecret}`, 'utf8').toString('base64'),
      'privy-app-id': settings.appId,
    };
    const init: RequestInit = { method, headers, signal: controller.signal, redirect: 'error' };
    if (signed !== undefined) {
      headers['content-type'] = 'application/json';
      headers['privy-authorization-signature'] = signed.signature;
      if (signed.idempotencyKey !== undefined) headers['privy-idempotency-key'] = signed.idempotencyKey;
      init.body = signed.bodyJson;
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await settings.fetch(settings.origin + path, init);
    // fetch를 주입한 전송 계층도 취소 상태를 확인한다.
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      throw new PrivyApiError('UNAVAILABLE');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
          controller.abort();
          void reader.cancel().catch(() => {});
          throw new PrivyApiError('UNAVAILABLE');
        }
        chunks.push(value);
      }
    }
    if (response.status !== expectedStatus) throw new PrivyApiError(statusCode(response.status), response.status,
      retryAfter(response.headers.get('retry-after')));
    try {
      return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown;
    } catch {
      throw new PrivyApiError('INVALID_RESPONSE');
    }
  };
  try {
    return await Promise.race([stopped, execute()]);
  } catch (error) {
    if (error instanceof PrivyApiError) throw error;
    throw new PrivyApiError(signal?.aborted ? 'INTERRUPTED' : 'UNAVAILABLE');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
