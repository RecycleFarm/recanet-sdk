/** JSON 숫자의 원문을 보관해 검증 전에 부동소수점 반올림이 일어나지 않게 한다. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

export type JsonValue = null | boolean | string | JsonNumber | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }

/** 중복 필드와 과도한 중첩을 거부한다. 오류에 입력 원문을 넣지 않는다. */
export function parseLosslessJson(source: string): JsonValue {
  let offset = 0;
  const invalid = (): never => { throw new SyntaxError('JSON 형식이 올바르지 않습니다'); };
  const whitespace = () => {
    while (/[\x20\t\r\n]/.test(source[offset] ?? '') && offset < source.length) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const ch = source[offset++];
      if (ch === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string; } catch { return invalid(); }
      }
      if (ch === '\\') offset++;
    }
    return invalid();
  };
  const value = (depth: number): JsonValue => {
    if (depth > 128) return invalid();
    whitespace();
    const ch = source[offset];
    if (ch === '"') return string();
    if (ch === '{' || ch === '[') {
      offset++;
      const object: JsonObject = Object.create(null) as JsonObject;
      const array: JsonValue[] = [];
      const end = ch === '{' ? '}' : ']';
      whitespace();
      if (source[offset] === end) { offset++; return ch === '{' ? object : array; }
      while (true) {
        if (ch === '{') {
          whitespace();
          if (source[offset] !== '"') return invalid();
          const key = string();
          whitespace();
          if (source[offset++] !== ':' || Object.hasOwn(object, key)) return invalid();
          object[key] = value(depth + 1);
        } else array.push(value(depth + 1));
        whitespace();
        if (source[offset] === end) { offset++; return ch === '{' ? object : array; }
        if (source[offset++] !== ',') return invalid();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset))?.[0];
    if (number === undefined) return invalid();
    offset += number.length;
    return new JsonNumber(number);
  };
  const result = value(0);
  whitespace();
  if (offset !== source.length) return invalid();
  return result;
}

export function jsonObject(value: JsonValue): JsonObject {
  if (value === null || typeof value !== 'object' || value instanceof JsonNumber || Array.isArray(value)) {
    throw new TypeError('JSON 객체가 필요합니다');
  }
  return value;
}

/** 음이 아닌 정수값을 정확하게 변환한다. 거대한 지수에 비례해 메모리를 할당하지 않는다. */
export function numericDate(value: JsonValue | undefined): bigint {
  if (!(value instanceof JsonNumber)) throw new TypeError('NumericDate가 필요합니다');
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.source)!;
  let digits = (match[2]! + (match[3] ?? '')).replace(/^0+/, '');
  if (digits === '') return 0n;
  if (match[1] === '-') throw new TypeError('NumericDate 범위 오류');
  const power = BigInt(match[4] ?? '0') - BigInt(match[3]?.length ?? 0);
  if (power < 0n) {
    const count = -power;
    if (count >= BigInt(digits.length)) throw new TypeError('NumericDate는 정수여야 합니다');
    const tail = digits.slice(-Number(count));
    if (!/^0+$/.test(tail)) throw new TypeError('NumericDate는 정수여야 합니다');
    digits = digits.slice(0, -Number(count));
  } else {
    if (BigInt(digits.length) + power > 16n) throw new TypeError('NumericDate 범위 오류');
    digits += '0'.repeat(Number(power));
  }
  const result = BigInt(digits);
  if (result > 9223372036854775n) throw new TypeError('NumericDate 범위 오류');
  return result;
}
