import { javaDouble, javaFloat } from './internal/java-number.js';

/** Explicit java.lang.Double binding, including integral doubles and negative zero. */
export class Float64 {
  constructor(readonly value: number) { if (typeof value !== 'number') throw new TypeError('number required'); Object.freeze(this); }
  toString(): string { return javaDouble(this.value); }
  toJSON(): number | string { return Number.isFinite(this.value) ? this.value : this.toString(); }
}
/** Explicit java.lang.Float binding; rounds to binary32 before encoding. */
export class Float32 {
  readonly value: number;
  constructor(value: number) { if (typeof value !== 'number') throw new TypeError('number required'); this.value = Math.fround(value); Object.freeze(this); }
  toString(): string { return javaFloat(this.value); }
  toJSON(): number | string { return Number.isFinite(this.value) ? this.value : this.toString(); }
}
