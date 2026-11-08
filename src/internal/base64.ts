/** Java standard Base64 decoder accepts missing final padding, but no whitespace or URL alphabet. */
export function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string') throw new TypeError('Base64 문자열이 필요합니다');
  const raw = text.replace(/=+$/, ''), padding = text.length - raw.length;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || raw.length % 4 === 1
    || (padding > 0 && (text.length % 4 !== 0 || padding !== 4 - raw.length % 4))) throw new TypeError('잘못된 Base64 응답');
  return Uint8Array.from(Buffer.from(text, 'base64'));
}
