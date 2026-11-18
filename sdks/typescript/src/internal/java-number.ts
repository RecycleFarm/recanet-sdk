/** Java 17 Double.toString: shortest digits inside the strict adjacent-value interval.
 * Scientific output requires at least two significant digits. All interval arithmetic is exact.
 */
export function javaDouble(value: number): string { return floating(value, false); }
export function javaFloat(value: number): string { return floating(Math.fround(value), true); }
function floating(value: number, single: boolean): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value < 0 ? '-Infinity' : 'Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  const negative = value < 0, absolute = Math.abs(value);
  const view = new DataView(new ArrayBuffer(8));
  if (single) view.setFloat32(0, absolute); else view.setFloat64(0, absolute);
  const bits = single ? BigInt(view.getUint32(0)) : view.getBigUint64(0);
  const fractionBits = single ? 23n : 52n, bias = single ? 127 : 1023;
  const denominator = 1n << (single ? 149n : 1074n);
  const scaled = (raw: bigint): bigint => {
    const exponent = Number(raw >> fractionBits), fraction = raw & ((1n << fractionBits) - 1n);
    return exponent === 0 ? fraction : ((1n << fractionBits) + fraction) << BigInt(exponent - 1);
  };
  const exact = scaled(bits), previous = scaled(bits - 1n);
  const next = bits === (single ? 0x7f7fffffn : 0x7fefffffffffffffn) ? exact + (exact - previous) : scaled(bits + 1n);
  const significand = bits & ((1n << fractionBits) - 1n);
  const powerOfTwo = bits >> fractionBits === 0n ? (bits & (bits - 1n)) === 0n : significand === 0n;
  const boundScale = powerOfTwo ? 4n : 2n;
  const lower = powerOfTwo ? 4n * exact - (next - exact) : exact + previous;
  const upper = powerOfTwo ? 4n * exact + (next - exact) : exact + next;
  let exponent = Math.floor(Math.log10(absolute));
  const comparePower = (e: number) => e < 0 ? exact * 10n ** BigInt(-e) - denominator : exact - denominator * 10n ** BigInt(e);
  while (comparePower(exponent) < 0n) exponent--;
  while (comparePower(exponent + 1) >= 0n) exponent++;
  // FloatingDecimal's historical signed-long rounding corner in Java 17.
  if (single && bits === 0x69000000n) return (negative ? '-' : '') + '9.6714065E24';
  let digits = '', scale = 0;
  const binaryExponent = Number(bits >> fractionBits) - bias;
  // Java 17's exact-long fast path rounds only its insignificant low decimal digits.
  if (binaryExponent <= 62 && Number.isInteger(absolute)) {
    const threshold = single ? 25 : 54;
    const insignificant = binaryExponent < threshold ? 0 : (1n << BigInt(binaryExponent - threshold)).toString().length - 1;
    const power = 10n ** BigInt(insignificant), integer = BigInt(absolute);
    digits = String((integer + power / 2n) / power); scale = insignificant;
  }
  // A shortest carry into the next decimal decade is retained before scientific .0 padding.
  const carryScale = exponent + 1;
  const carryMultiplier = carryScale < 0 ? 10n ** BigInt(-carryScale) : 1n;
  const carryPosition = boundScale * denominator * (carryScale > 0 ? 10n ** BigInt(carryScale) : 1n);
  const rawExponent = Number(bits >> fractionBits);
  const leading = rawExponent === 0 ? significand.toString(2).length - 1 : Number(fractionBits);
  const normalized = rawExponent === 0 ? Number(significand) / 2 ** leading : 1 + Number(significand) / 2 ** Number(fractionBits);
  const normalizedExponent = rawExponent === 0 ? leading - (single ? 149 : 1074) : binaryExponent;
  const estimatedExponent = Math.floor((normalized - 1.5) * 0.289529654602168 + 0.1760912590558 + normalizedExponent * 0.301029995663981);
  if (!digits && estimatedExponent > exponent && (exponent < -3 || exponent >= 7) && carryPosition > lower * carryMultiplier && carryPosition < upper * carryMultiplier)
    return (negative ? '-' : '') + '1.0E' + carryScale;
  for (let precision = exponent < -3 || exponent >= 7 ? 2 : 1; !digits && precision <= (single ? 9 : 18); precision++) {
    scale = exponent - precision + 1;
    const multiplier = scale < 0 ? 10n ** BigInt(-scale) : 1n;
    const step = boundScale * denominator * (scale > 0 ? 10n ** BigInt(scale) : 1n);
    const dividend = boundScale * exact * multiplier;
    let candidate = dividend / step;
    const remainder = dividend % step;
    if (2n * remainder > step || (2n * remainder === step && candidate % 2n !== 0n)) candidate++;
    const position = candidate * step;
    if (position > lower * multiplier && position < upper * multiplier) { digits = String(candidate); break; }
  }
  if (!digits) throw new RangeError('Cannot encode finite double');
  while (digits.length > 1 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale++; }
  const scientificExponent = digits.length + scale - 1;
  let result: string;
  if (scientificExponent < -3 || scientificExponent >= 7) {
    result = digits[0] + '.' + (digits.slice(1) || '0') + 'E' + scientificExponent;
  } else {
    const point = digits.length + scale;
    result = point <= 0 ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length ? digits + '0'.repeat(point - digits.length) + '.0'
      : digits.slice(0, point) + '.' + digits.slice(point);
  }
  return (negative ? '-' : '') + result;
}
