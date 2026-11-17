/** Java long 범위를 손실 없이 표현한다. */
export function chainNumber(value: bigint | number, positive = false): bigint {
  if (typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    throw new TypeError('chainId는 정수 또는 bigint여야 합니다');
  }
  const result = BigInt(value);
  if (result < -(1n << 63n) || result >= (1n << 63n) || (positive && result <= 0n)) {
    throw new TypeError('chainId가 64비트 범위를 벗어났습니다');
  }
  return result;
}
