import { CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { decodeBase64 } from './base64.js';
import { decodeJavaUtf8 } from './java-utf8.js';

function suite(): CipherSuite {
  return new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
}
export async function openExportMessage(pair: CryptoKeyPair, encapsulatedKey: string, ciphertext: string): Promise<string> {
  const recipient = await suite().createRecipientContext({ recipientKey: pair, enc: decodeBase64(encapsulatedKey).buffer, info: new Uint8Array() });
  const plaintext = await recipient.open(decodeBase64(ciphertext).buffer, new Uint8Array());
  return decodeJavaUtf8(new Uint8Array(plaintext));
}
/** Privy Java 0.59 fixed suite: base mode, empty info/AAD, first message only. */
export async function createExportReceiver(): Promise<{
  recipientPublicKey: string;
  open(encapsulatedKey: string, ciphertext: string): Promise<string>;
}> {
  const pair = await suite().kem.generateKeyPair();
  const spki = await globalThis.crypto.subtle.exportKey('spki', pair.publicKey);
  return {
    recipientPublicKey: Buffer.from(spki).toString('base64'),
    open: (encapsulatedKey, ciphertext) => openExportMessage(pair, encapsulatedKey, ciphertext),
  };
}
