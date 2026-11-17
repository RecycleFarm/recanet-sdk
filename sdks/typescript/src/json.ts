import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnError } from './errors.js';

/** Public Java Json API. Broader JSON helpers remain package-internal. */
export class Json {
  private constructor() {}
  static parse(bytes: Uint8Array): unknown { return DmrvnJson.parse(bytes); }
  static object(bytes: Uint8Array): Record<string, unknown> { return DmrvnJson.object(bytes); }
  static canonical(value: unknown): string { return DmrvnJson.canonical(value); }
  static bytes(value: unknown): Uint8Array { return DmrvnJson.bytes(value); }
  static hash(value: unknown): string { return DmrvnJson.hash(value); }
  static copy(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new DmrvnError('INVALID_INPUT');
    return DmrvnJson.object(DmrvnJson.bytes(value));
  }
}
