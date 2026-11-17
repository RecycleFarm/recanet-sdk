/** Lossless java.time.Duration binding. Timers use monotonic bigint nanoseconds. */
export class Duration {
  readonly nanoseconds: bigint;
  private constructor(nanoseconds: bigint) {
    const seconds = nanoseconds >= 0n ? nanoseconds / 1000000000n : (nanoseconds - 999999999n) / 1000000000n;
    if (seconds < -(1n << 63n) || seconds >= 1n << 63n) throw new RangeError('Duration exceeds signed int64 seconds');
    this.nanoseconds = nanoseconds;
    Object.freeze(this);
  }
  static ofNanos(value: bigint | number): Duration { return new Duration(integer(value)); }
  static ofMillis(value: bigint | number): Duration { return new Duration(integer(value) * 1000000n); }
  static ofSeconds(value: bigint | number, nanoAdjustment: bigint | number = 0): Duration {
    return new Duration(integer(value) * 1000000000n + integer(nanoAdjustment));
  }
  static ofMinutes(value: bigint | number): Duration { return new Duration(integer(value) * 60000000000n); }
  toMillis(): bigint {
    const millis = this.nanoseconds / 1000000n;
    if (millis < -(1n << 63n) || millis >= 1n << 63n) throw new RangeError('Duration milliseconds overflow');
    return millis;
  }
  toNanos(): bigint {
    if (this.nanoseconds < -(1n << 63n) || this.nanoseconds >= 1n << 63n) throw new RangeError('Duration nanoseconds overflow');
    return this.nanoseconds;
  }
  isNegative(): boolean { return this.nanoseconds < 0n; }
  isZero(): boolean { return this.nanoseconds === 0n; }
  compareTo(other: Duration): number { return this.nanoseconds < other.nanoseconds ? -1 : this.nanoseconds > other.nanoseconds ? 1 : 0; }
  static readonly ZERO = Duration.ofNanos(0n);
}
function integer(value: bigint | number): bigint {
  if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw new TypeError('Exact integer required');
  const result = BigInt(value);
  if (result < -(1n << 63n) || result >= 1n << 63n) throw new RangeError('Duration argument exceeds signed int64');
  return result;
}
/** @internal Convert legacy ms options without silently rounding large or fractional values. */
export function duration(value: Duration | bigint | number): Duration {
  if (value instanceof Duration) return value;
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
    const nanos = value * 1000000;
    if (!Number.isSafeInteger(nanos)) throw new TypeError('Duration requires exact nanoseconds');
    return Duration.ofNanos(nanos);
  }
  return Duration.ofMillis(value);
}
/** @internal Chunk Node's int32 timers; do not coerce large durations to immediate timeouts. */
export function deadlineTimer(delayNs: bigint, action: () => void): () => void {
  const end = process.hrtime.bigint() + delayNs;
  let timer: ReturnType<typeof setTimeout> | undefined, active = true;
  const tick = () => {
    if (!active) return;
    const left = end - process.hrtime.bigint();
    if (left <= 0n) { active = false; action(); }
    else timer = setTimeout(tick, Number(left > 2147483647000000n ? 2147483647n : (left + 999999n) / 1000000n));
  };
  tick();
  return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
}
