/** ETH/일반 거래 조회의 최소 길이 uint256 quantity. DMRVN Chain 경계와 다르다. */
export function uint256(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) {
    throw new TypeError('최소 길이 uint256 quantity가 필요합니다');
  }
  return BigInt(value);
}

export function evmHex(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || !new RegExp('^0x[0-9a-fA-F]{' + bytes * 2 + '}$').test(value)) {
    throw new TypeError('EVM hex 형식이 올바르지 않습니다');
  }
  return value;
}

export function quantity(value: bigint): string { return '0x' + value.toString(16); }
