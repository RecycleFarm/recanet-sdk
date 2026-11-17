import { DmrvnError } from '../errors.js';

/** Java DMRVN URI 경계: scheme/loopback host의 대소문자를 그대로 검사한다. */
export function dmrvnUri(input: string): string {
  if (typeof input !== 'string' || /[\x00-\x20\x7f\\#]/.test(input)) throw new DmrvnError('INVALID_INPUT');
  const authority = /^(https|http):\/\/([^/?#]+)/.exec(input);
  if (!authority || authority[2]!.includes('@')) throw new DmrvnError('INVALID_INPUT');
  const host = authority[2]!.replace(/:\d+$/, '');
  if (authority[1] === 'http' && !['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new DmrvnError('INVALID_INPUT');
  try { return new URL(input).href; } catch { throw new DmrvnError('INVALID_INPUT'); }
}
