import { Duration, duration, deadlineTimer } from './duration.js';
import { javaHttpFetch } from './internal/java-http.js';
import { DmrvnError } from './errors.js';
import { canonicalChainJson, parseChainJson, rpcIdText } from './internal/chain-json.js';
import { JsonNumber } from './internal/lossless-json.js';
import { dmrvnUri } from './internal/dmrvn-uri.js';

export interface EvmRpc {
  call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown>;
}

export interface HttpEvmRpcOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number | bigint;
  readonly timeout?: Duration;
  /** 기본 transport의 TCP/TLS 연결 단계 상한. */
  readonly connectTimeoutMs?: number | bigint;
  readonly connectTimeout?: Duration;
}

/** 제한된 EVM JSON-RPC 2.0 전송. 비밀 header·배치·자동 재시도를 사용하지 않는다. */
export class HttpEvmRpc implements EvmRpc {
  #url: string;
  #fetch: typeof globalThis.fetch;
  #timeout: Duration;
  #connect: Duration;
  #id = 0;

  constructor(url: string, options: HttpEvmRpcOptions = {}) {
    this.#url = dmrvnUri(url);
    try { this.#timeout = options.timeout ?? duration(options.timeoutMs ?? 30000); } catch { throw new DmrvnError('INVALID_INPUT'); }
    try { this.#connect = options.connectTimeout ?? duration(options.connectTimeoutMs ?? 10000); } catch { throw new DmrvnError('INVALID_INPUT'); }
    if (!(this.#timeout instanceof Duration) || this.#timeout.isNegative() || this.#timeout.isZero()
      || !(this.#connect instanceof Duration) || this.#connect.isNegative() || this.#connect.isZero()) throw new DmrvnError('INVALID_INPUT');
    this.#timeout.toMillis();
    this.#fetch = options.fetch ?? javaHttpFetch(this.#connect);
    if (typeof this.#fetch !== 'function') throw new DmrvnError('INVALID_INPUT');
  }

  async call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DmrvnError('INTERRUPTED');
    if (typeof method !== 'string' || !Array.isArray(params)) throw new DmrvnError('INVALID_INPUT');
    const id = ++this.#id;
    if (!Number.isSafeInteger(id)) throw new DmrvnError('INVALID_INPUT');
    const body = canonicalChainJson({ jsonrpc: '2.0', id, method, params });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let rejectStop: (error: DmrvnError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    const stop = (code: 'INTERRUPTED' | 'RPC_UNAVAILABLE') => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      rejectStop(new DmrvnError(code));
    };
    let cancelTimer = () => {};
    const onAbort = () => stop('INTERRUPTED');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const execute = async () => {
      if (controller.signal.aborted) throw new DmrvnError('INTERRUPTED');
      const response = await this.#fetch(this.#url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body, signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new DmrvnError('RPC_UNAVAILABLE');
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (response.body) {
        reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4194304) {
            controller.abort();
            void reader.cancel().catch(() => {});
            throw new DmrvnError('RPC_UNAVAILABLE');
          }
          chunks.push(value);
        }
      }
      if (response.status !== 200) throw new DmrvnError('RPC_UNAVAILABLE');
      let responseId: string | undefined;
      const parsed = parseChainJson(Buffer.concat(chunks, size), raw => {
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof JsonNumber)) {
          responseId = raw.id === undefined ? undefined : rpcIdText(raw.id);
        }
      });
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DmrvnError('INVALID_INPUT');
      const result = parsed as Record<string, unknown>;
      if (result.jsonrpc !== '2.0' || responseId !== String(id)) throw new DmrvnError('RPC_UNAVAILABLE');
      if (Object.hasOwn(result, 'error')) throw new DmrvnError(
        method === 'eth_estimateGas' || method === 'eth_call' ? 'GAS_ESTIMATION_FAILED' : 'RPC_UNAVAILABLE');
      if (!Object.hasOwn(result, 'result')) throw new DmrvnError('RPC_UNAVAILABLE');
      return result.result;
    };
    try {
      const pending = execute();
      cancelTimer = deadlineTimer(this.#timeout.toMillis() * 1000000n, () => stop('RPC_UNAVAILABLE'));
      return await Promise.race([stopped, pending]);
    }
    catch (error) {
      if (error instanceof DmrvnError) throw error;
      throw new DmrvnError(signal?.aborted ? 'INTERRUPTED' : 'RPC_UNAVAILABLE');
    } finally {
      cancelTimer();
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
