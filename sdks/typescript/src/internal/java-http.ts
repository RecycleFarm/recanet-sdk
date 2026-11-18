import http from 'node:http';
import https from 'node:https';
import { Duration, deadlineTimer } from '../duration.js';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const transports = new WeakSet<typeof globalThis.fetch>();
export const isJavaHttpFetch = (fetch: typeof globalThis.fetch): boolean => transports.has(fetch);

/** Raw URI path and header values are preserved, unlike WHATWG Fetch normalization. */
export function javaHttpFetch(connectTimeout = Duration.ofSeconds(10), readTimeout?: Duration, followRedirects = false): typeof globalThis.fetch {
  const rawFetch = ((input: string | URL | Request, init: RequestInit = {}): Promise<Response> => new Promise((resolve, reject) => {
    const raw = String(input), parsed = new URL(raw);
    const tail = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^#]*)/i.exec(raw)?.[1] ?? '';
    const path = (tail.startsWith('?') ? '/' + tail : tail || '/').replace(/[^\x00-\x7f]/gu, value => encodeURIComponent(value));
    let settled = false, cancelConnect = () => {}, cancelRead = () => {};
    const headers: Record<string, string> = {};
    if (init.headers instanceof Headers) init.headers.forEach((value, key) => { headers[key] = value; });
    else if (Array.isArray(init.headers)) for (const [key,value] of init.headers) headers[key] = value;
    else Object.assign(headers, init.headers);
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'host')) headers.host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(raw)![1]!;
    const request = (parsed.protocol === 'https:' ? https : http).request({ protocol: parsed.protocol,
      hostname: parsed.hostname.replace(/^\[|\]$/g, ''), port: parsed.port || undefined,
      path, method: init.method ?? 'GET', headers, agent: parsed.protocol === 'https:' ? httpsAgent : httpAgent });
    const cleanup = () => { cancelConnect(); cancelRead(); init.signal?.removeEventListener('abort', abort); };
    const fail = (error: Error) => { request.destroy(error); if (!settled) { settled = true; cleanup(); reject(error); } };
    const abort = () => fail(new Error('Request interrupted'));
    request.once('error', error => { if (!settled) { settled = true; cleanup(); reject(error); } });
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) { abort(); return; }
    const resetRead = () => {
      cancelRead();
      if (readTimeout) cancelRead = deadlineTimer(readTimeout.nanoseconds, () => fail(new Error('Read timeout')));
    };
    request.once('socket', socket => {
      const connected = () => { cancelConnect(); resetRead(); };
      if (socket.connecting) {
        cancelConnect = deadlineTimer(connectTimeout.nanoseconds, () => fail(new Error('Connection timeout')));
        socket.once(parsed.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
      } else connected();
    });
    request.once('response', response => {
      cancelConnect(); resetRead();
      const outHeaders = new Headers();
      for (let i=0; i<response.rawHeaders.length; i+=2) outHeaders.append(response.rawHeaders[i]!, response.rawHeaders[i+1]!);
      let bodyDone = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          response.on('data', (chunk: Buffer) => { if (!bodyDone) { resetRead(); controller.enqueue(new Uint8Array(chunk)); } });
          response.once('end', () => { cleanup(); if (!bodyDone) { bodyDone = true; controller.close(); } });
          response.once('error', error => { cleanup(); if (!bodyDone) { bodyDone = true; controller.error(error); } });
          response.once('aborted', () => { cleanup(); if (!bodyDone) { bodyDone = true; controller.error(new Error('Response aborted')); } });
        },
        cancel() { bodyDone = true; cleanup(); response.destroy(); request.destroy(); },
      });
      settled = true;
      resolve(new Response([204,205,304].includes(response.statusCode!) ? null : body,
        { status: response.statusCode!, headers: outHeaders }));
    });
    const payload = init.body;
    if (payload != null && typeof payload !== 'string' && !(payload instanceof Uint8Array)) { fail(new TypeError('String or byte body required')); return; }
    request.end(payload);
  })) as typeof globalThis.fetch;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let target = String(input);
    for (let redirects = 0; ; redirects++) {
      const response = await rawFetch(target, init);
      const location = response.headers.get('location');
      if (!followRedirects || ![301,302,303,307].includes(response.status) || location === null || redirects >= 19) return response;
      const next = new URL(location, target);
      if (next.protocol !== new URL(target).protocol) return response;
      await response.body?.cancel(); target = next.href;
    }
  };
  transports.add(fetch); return fetch;
}
