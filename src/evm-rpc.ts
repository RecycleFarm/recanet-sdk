import { DmrvnError } from './errors.js';
import { canonicalChainJson, parseChainJson, rpcIdText } from './internal/chain-json.js';
import { JsonNumber } from './internal/lossless-json.js';

export interface EvmRpc {
  call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown>;
}

export interface HttpEvmRpcOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  /** Fetch가 응답 header를 반환할 때까지의 연결 단계 상한. */
  readonly connectTimeoutMs?: number;
}

function endpoint(input: string): string {
  if (typeof input !== 'string' || /[\x00-\x20\x7f\\#]/.test(input)) throw new DmrvnError('INVALID_INPUT');
  const authority = /^(https|http):\/\/([^/?#]+)/.exec(input);
  if (!authority || authority[2]!.includes('@')) throw new DmrvnError('INVALID_INPUT');
  const host = authority[2]!.replace(/:\d+$/, '');
  if (authority[1] === 'http' && !['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new DmrvnError('INVALID_INPUT');
  try { return new URL(input).href; } catch { throw new DmrvnError('INVALID_INPUT'); }
}

/** 제한된 EVM JSON-RPC 2.0 전송. 비밀 header·배치·자동 재시도를 사용하지 않는다. */
export class HttpEvmRpc implements EvmRpc {
  #url: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  #connect: number;
  #id = 0;

  constructor(url: string, options: HttpEvmRpcOptions = {}) {
    this.#url = endpoint(url);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 30000;
    this.#connect = options.connectTimeoutMs ?? 10000;
    if (typeof this.#fetch !== 'function' || ![this.#timeout, this.#connect].every(value =>
      Number.isSafeInteger(value) && value >= 1)) throw new DmrvnError('INVALID_INPUT');
  }

  async call(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DmrvnError('INTERRUPTED');
    if (typeof method !== 'string' || !Array.isArray(params)) throw new DmrvnError('INVALID_INPUT');
    const id = ++this.#id;
    if (!Number.isSafeInteger(id)) throw new DmrvnError('INVALID_INPUT');
    const body = canonicalChainJson({ jsonrpc: '2.0', id, method, params });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectStop: (error: DmrvnError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    const start = performance.now();
    let deadline = start + Math.min(this.#connect, this.#timeout);
    const stop = (code: 'INTERRUPTED' | 'RPC_UNAVAILABLE') => {
      controller.abort();
      void reader?.cancel().catch(() => {});
      rejectStop(new DmrvnError(code));
    };
    const schedule = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) stop('RPC_UNAVAILABLE');
      else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    };
    const onAbort = () => stop('INTERRUPTED');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else schedule();
    const execute = async () => {
      if (controller.signal.aborted) throw new DmrvnError('INTERRUPTED');
      const response = await this.#fetch(this.#url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body, signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new DmrvnError('RPC_UNAVAILABLE');
      }
      clearTimeout(timer);
      deadline = start + this.#timeout;
      schedule();
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
    try { return await Promise.race([stopped, execute()]); }
    catch (error) {
      if (error instanceof DmrvnError) throw error;
      throw new DmrvnError(signal?.aborted ? 'INTERRUPTED' : 'RPC_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
