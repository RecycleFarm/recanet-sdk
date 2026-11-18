import { isIP } from 'node:net';
import { DmrvnError } from '../errors.js';

/** java.net.URI server-authority syntax; retain the exact input for requests. */
export function dmrvnUri(input: string): string { return httpUri(input, false, false); }

export function privyOrigin(input: string): string {
  try { return httpUri(input, true, true); } catch { throw new TypeError('Invalid API origin'); }
}

export function trustedJwksUri(input: string): string {
  try { return httpUri(input, true, false); } catch { throw new TypeError('Invalid JWKS URI'); }
}

function httpUri(input: string, caseInsensitive: boolean, originOnly: boolean): string {
  const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };
  if (typeof input !== 'string' || /[\p{Z}\p{Cc}\\#<>"{}|^`]/u.test(input)) return invalid();
  const parsed = /^(https|http):\/\/(\[[^\]]+\]|[^/?#:]+)(?::([0-9]*))?([^#]*)$/i.exec(input);
  if (!parsed || (!caseInsensitive && !['https', 'http'].includes(parsed[1]!))) return invalid();
  const [, scheme, host, port, tail] = parsed;
  if (!host || host.includes('@') || (port && BigInt(port) > 2147483647n)) return invalid();
  if (originOnly && tail !== '') return invalid();
  if (tail && !tail.startsWith('/') && !tail.startsWith('?')) return invalid();
  const path = tail!.split('?')[0]!;
  if (/[\[\]]/.test(path) || /%(?![0-9a-fA-F]{2})/.test(tail!)) return invalid();
  if (host.startsWith('[')) {
    const inside = host.slice(1, -1), percent = inside.indexOf('%');
    const address = percent === -1 ? inside : inside.slice(0, percent);
    const scope = percent === -1 ? undefined : inside.slice(percent + 1);
    if (isIP(address) !== 6 || (scope !== undefined && !/^[A-Za-z0-9_.]+$/.test(scope))) return invalid();
  } else {
    const hostname = host.endsWith('.') ? host.slice(0, -1) : host;
    const labels = hostname.split('.');
    if (labels.some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) return invalid();
    if (labels.length > 1 && !/^[A-Za-z]/.test(labels.at(-1)!)) {
      if (labels.length !== 4 || labels.some(label => !/^\d+$/.test(label) || Number(label) > 255)) return invalid();
    }
  }
  if (scheme!.toLowerCase() === 'http' && !['localhost', '127.0.0.1', '[::1]'].includes(caseInsensitive ? host.toLowerCase() : host)) return invalid();
  return input;
}
