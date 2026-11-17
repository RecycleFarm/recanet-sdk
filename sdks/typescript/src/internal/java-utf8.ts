/** Java String(bytes, UTF_8) groups surrogate encodings into one replacement character.
 * Node's decoder otherwise uses the same malformed-prefix boundaries, but rejects each
 * byte of ED A0..BF [80..BF] separately. Preserve Java's grouping before native decoding.
 */
export function decodeJavaUtf8(input: Uint8Array): string {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength), pieces: string[] = [];
  let start = 0;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] !== 0xed || bytes[i + 1]! < 0xa0 || bytes[i + 1]! > 0xbf) continue;
    pieces.push(bytes.subarray(start, i).toString('utf8'), '\ufffd');
    const third = bytes[i + 2];
    i += third !== undefined && third >= 0x80 && third <= 0xbf ? 2 : 1;
    start = i + 1;
  }
  pieces.push(bytes.subarray(start).toString('utf8'));
  return pieces.join('');
}
