import { javaUtf8 } from './dmrvn-crypto.js';
import { DmrvnError } from './errors.js';
import { dmrvnUri } from './internal/dmrvn-uri.js';

export interface ReportReader {
  read(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Uint8Array>;
}
export interface GreenfieldPublicReaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
  readonly connectTimeoutMs?: number;
}

function encode(value: string): string {
  // Java URLEncoder의 문자 집합을 사용하고 '+'만 %20으로 바꾼다.
  return [...javaUtf8(value)].map(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
    || (byte >= 48 && byte <= 57) || [45, 46, 95, 42].includes(byte) ? String.fromCharCode(byte)
    : '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/** 구성한 Storage Provider에서 공개 객체를 직접 읽는다. private 객체 권한을 제공하지 않는다. */
export class GreenfieldPublicReader implements ReportReader {
  #endpoint: string;
  #chainId: string;
  #fetch: typeof globalThis.fetch;
  #timeout: number;
  #connect: number;
  constructor(endpoint: string, chainId: string, options: GreenfieldPublicReaderOptions = {}) {
    this.#endpoint = dmrvnUri(endpoint).replace(/\/+$/, '');
    if (endpoint.includes('?') || typeof chainId !== 'string') throw new DmrvnError('INVALID_INPUT');
    this.#chainId = chainId;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeout = options.timeoutMs ?? 30000;
    this.#connect = options.connectTimeoutMs ?? 10000;
    if (typeof this.#fetch !== 'function' || ![this.#timeout, this.#connect].every(value =>
      Number.isSafeInteger(value) && value >= 1)) throw new DmrvnError('INVALID_INPUT');
  }

  async read(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Uint8Array> {
    if (location.chainId !== this.#chainId || String(location.storageType) !== '1') throw new DmrvnError('WRONG_CHAIN');
    if (typeof location.bucketName !== 'string' || typeof location.objectName !== 'string') throw new DmrvnError('INVALID_INPUT');
    const parts = location.objectName.split('/');
    // WHATWG Fetch는 dot segment를 정규화하므로 다른 객체를 읽는 대신 명시적으로 거부한다 (TS-26).
    if ([location.bucketName, ...parts].some(part => part === '.' || part === '..')) throw new DmrvnError('INVALID_INPUT');
    const url = this.#endpoint + '/' + encode(location.bucketName) + '/' + parts.map(encode).join('/');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectStop!: (error: DmrvnError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    const start = performance.now();
    let deadline = start + Math.min(this.#connect, this.#timeout);
    const stop = (code: 'INTERRUPTED' | 'STORAGE_UNAVAILABLE') => {
      rejectStop(new DmrvnError(code));
      controller.abort();
      void reader?.cancel().catch(() => {});
    };
    const schedule = () => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) stop('STORAGE_UNAVAILABLE');
      else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
    };
    const onAbort = () => stop('INTERRUPTED');
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else schedule();
    const execute = async () => {
      if (controller.signal.aborted) throw new DmrvnError('INTERRUPTED');
      const response = await this.#fetch(url, { method: 'GET', signal: controller.signal, redirect: 'error', credentials: 'omit' });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new DmrvnError('STORAGE_UNAVAILABLE');
      }
      clearTimeout(timer);
      deadline = start + this.#timeout;
      schedule();
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new DmrvnError('STORAGE_UNAVAILABLE');
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
            controller.abort(); void reader.cancel().catch(() => {});
            throw new DmrvnError('STORAGE_UNAVAILABLE');
          }
          chunks.push(value);
        }
      }
      if (response.status === 401 || response.status === 403) throw new DmrvnError('STORAGE_ACCESS_DENIED');
      if (response.status !== 200) throw new DmrvnError('STORAGE_UNAVAILABLE');
      return Uint8Array.from(Buffer.concat(chunks, size));
    };
    try { return await Promise.race([stopped, execute()]); }
    catch (error) {
      if (error instanceof DmrvnError) throw error;
      throw new DmrvnError(signal?.aborted ? 'INTERRUPTED' : 'STORAGE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
