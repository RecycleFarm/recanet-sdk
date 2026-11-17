import claim from './resources/dmrvn/dmrvn-claim-v7.json' with { type: 'json' };
import forwarder from './resources/dmrvn/dmrvn-forwarder.json' with { type: 'json' };
import proxyAdmin from './resources/dmrvn/proxy-admin.json' with { type: 'json' };
import { DmrvnError } from './errors.js';
import { bytes32, hexBytes, hexString, javaUtf8, normalizeAddress, textHash, uint, word } from './dmrvn-crypto.js';

export interface AbiField {
  readonly name: string;
  readonly type: string;
  readonly components?: readonly AbiField[];
  readonly indexed?: boolean;
}

export interface AbiDefinition {
  readonly name?: string;
  readonly type: string;
  readonly inputs?: readonly AbiField[];
  readonly outputs?: readonly AbiField[];
}

const invalid = (): never => { throw new DmrvnError('INVALID_INPUT'); };
const join = (...values: Uint8Array[]) => Uint8Array.from(Buffer.concat(values));
function map(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return invalid();
  return value as Record<string, unknown>;
}
function str(value: unknown): string { if (typeof value !== 'string') return invalid(); return value; }

class Field {
  readonly name: string;
  readonly type: string;
  readonly children: readonly Field[];
  constructor(field: AbiField) {
    this.name = str(field.name);
    this.type = str(field.type);
    this.children = Object.freeze((field.components ?? []).map(child => new Field(child)));
    Object.freeze(this);
  }
  dynamic(): boolean { return this.type === 'tuple' ? this.children.some(child => child.dynamic())
    : this.type.endsWith('[]') || this.type === 'string' || this.type === 'bytes'; }
  size(): number { return this.dynamic() ? 32 : this.type === 'tuple' ? this.children.reduce((n, child) => n + child.size(), 0) : 32; }
  signature(): string { return this.type === 'tuple' ? '(' + this.children.map(child => child.signature()).join(',') + ')' : this.type; }
  element(): Field { return new Field({ name: '', type: this.type.slice(0, -2), components: this.children.map(child => child.definition()) }); }
  definition(): AbiField { return { name: this.name, type: this.type, components: this.children.map(child => child.definition()) }; }
}

function fields(values: readonly AbiField[]): Field[] { return values.map(value => new Field(value)); }
function tuple(definitions: readonly Field[], value: Record<string, unknown>): Uint8Array {
  return sequence(definitions, definitions.map(field => {
    if (!Object.hasOwn(value, field.name)) return invalid();
    return value[field.name];
  }));
}
function sequence(definitions: readonly Field[], values: readonly unknown[]): Uint8Array {
  const head: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  const headSize = definitions.reduce((n, field) => n + field.size(), 0);
  let tailSize = 0;
  for (let i = 0; i < definitions.length; i++) {
    const field = definitions[i]!;
    const encoded = write(field, values[i]);
    if (field.dynamic()) { head.push(word(BigInt(headSize + tailSize))); tail.push(encoded); tailSize += encoded.length; }
    else head.push(encoded);
  }
  return join(...head, ...tail);
}
function write(field: Field, value: unknown): Uint8Array {
  const type = field.type;
  if (type === 'tuple') return tuple(field.children, map(value));
  if (type.endsWith('[]')) {
    if (!Array.isArray(value) || value.length > 1024) return invalid();
    return join(word(BigInt(value.length)), sequence(Array.from({ length: value.length }, () => field.element()), value));
  }
  if (type === 'string' || type === 'bytes') {
    const bytes = type === 'string' ? javaUtf8(str(value)) : hexBytes(str(value));
    const padded = new Uint8Array(Math.ceil(bytes.length / 32) * 32);
    padded.set(bytes);
    return join(word(BigInt(bytes.length)), padded);
  }
  if (type === 'bytes32') return hexBytes(bytes32(str(value)));
  if (type === 'bytes1') {
    const bytes = hexBytes(str(value));
    if (bytes.length !== 1) return invalid();
    const result = new Uint8Array(32); result.set(bytes); return result;
  }
  if (type === 'address') return word(BigInt(normalizeAddress(str(value))));
  if (type === 'bool') {
    if (typeof value !== 'boolean') return invalid();
    return word(value ? 1n : 0n);
  }
  if (/^uint\d+$/.test(type)) return word(uint(value, Number(type.slice(4))));
  return invalid();
}

function slice(data: Uint8Array, start: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0
    || start > data.length - length) return invalid();
  return data.slice(start, start + length);
}
function offset(data: Uint8Array, start: number): number {
  const value = BigInt(hexString(slice(data, start, 32)));
  if (value > 2147483647n) return invalid();
  return Number(value);
}
function decode(definitions: readonly Field[], data: Uint8Array, start: number): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let cursor = start;
  for (const field of definitions) {
    const location = field.dynamic() ? start + offset(data, cursor) : cursor;
    if (location > 2147483647) return invalid();
    result[field.name] = read(field, data, location);
    cursor += field.size();
  }
  return result;
}
function read(field: Field, data: Uint8Array, start: number): unknown {
  const type = field.type;
  if (type === 'bytes1') {
    const bytes = slice(data, start, 32);
    if (bytes.slice(1).some(byte => byte !== 0)) return invalid();
    return hexString(bytes.slice(0, 1));
  }
  if (type === 'tuple') return decode(field.children, data, start);
  if (type.endsWith('[]')) {
    const count = offset(data, start);
    if (count > 1024) return invalid();
    const definitions = Array.from({ length: count }, (_, i) => new Field({ ...field.element().definition(), name: String(i) }));
    return Object.values(decode(definitions, data, start + 32));
  }
  if (type === 'string' || type === 'bytes') {
    const bytes = slice(data, start + 32, offset(data, start));
    if (type === 'bytes') return hexString(bytes);
    try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return invalid(); }
  }
  const bytes = slice(data, start, 32);
  const value = BigInt(hexString(bytes));
  if (type === 'bytes32') return hexString(bytes);
  if (type === 'address') { if (value >= 1n << 160n) return invalid(); return hexString(bytes.slice(12)); }
  if (type === 'bool') { if (value > 1n) return invalid(); return value === 1n; }
  if (/^uint\d+$/.test(type)) {
    const bits = Number(type.slice(4));
    if (bits < 1 || bits > 256 || value >= 1n << BigInt(bits)) return invalid();
    return bits <= 32 ? Number(value) : String(value);
  }
  return invalid();
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** 동봉 v7/Forwarder에서 사용하는 ABI 부분집합. 범용 Solidity ABI codec을 뜻하지 않는다. */
export class DmrvnAbi {
  static readonly CLAIM = new DmrvnAbi(claim as readonly AbiDefinition[]);
  static readonly FORWARDER = new DmrvnAbi(forwarder as readonly AbiDefinition[]);
  static readonly PROXY_ADMIN = new DmrvnAbi(proxyAdmin as readonly AbiDefinition[]);
  #definitions: readonly AbiDefinition[];
  constructor(definitions: readonly AbiDefinition[]) { this.#definitions = freeze(JSON.parse(JSON.stringify(definitions)) as AbiDefinition[]); }
  definition(name: string): AbiDefinition { return this.#definitions.find(value => value.name === name) ?? invalid(); }
  inputs(name: string): readonly AbiField[] { return this.definition(name).inputs ?? invalid(); }
  outputs(name: string): readonly AbiField[] { return this.definition(name).outputs ?? invalid(); }
  signature(name: string): string { return name + '(' + fields(this.inputs(name)).map(field => field.signature()).join(',') + ')'; }
  topic(name: string): string { return textHash(this.signature(name)); }
  encode(name: string, values: Readonly<Record<string, unknown>>): string {
    return this.topic(name).slice(0, 10) + hexString(tuple(fields(this.inputs(name)), map(values))).slice(2);
  }
  decodeCall(name: string, data: string): Record<string, unknown> {
    if (typeof data !== 'string' || data.length < 10 || data.slice(0, 10).toLowerCase() !== this.topic(name).slice(0, 10)) return invalid();
    const result = decode(fields(this.inputs(name)), hexBytes('0x' + data.slice(10)), 0);
    if (this.encode(name, result) !== data.toLowerCase()) return invalid();
    return result;
  }
  decodeOutput(name: string, data: string): Record<string, unknown> { return decode(fields(this.outputs(name)), hexBytes(data), 0); }
  decodeEvent(name: string, log: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (!Array.isArray(log.topics) || log.topics.length === 0 || str(log.topics[0]).toLowerCase() !== this.topic(name)) return invalid();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const normal: Field[] = [];
    let i = 1;
    for (const definition of this.inputs(name)) {
      const field = new Field(definition);
      if (definition.indexed === true) {
        if (i >= log.topics.length) return invalid();
        result[field.name] = read(field, hexBytes(str(log.topics[i++])), 0);
      } else normal.push(field);
    }
    if (i !== log.topics.length) return invalid();
    Object.assign(result, decode(normal, hexBytes(str(log.data)), 0));
    return result;
  }
  static encodeTuple(definitions: readonly AbiField[], values: Readonly<Record<string, unknown>>): string {
    return hexString(tuple(fields(definitions), map(values)));
  }
  static decodeTuple(definitions: readonly AbiField[], data: string): Record<string, unknown> {
    return decode(fields(definitions), hexBytes(data), 0);
  }
}
