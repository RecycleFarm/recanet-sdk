import { diagnosticOperation } from './diagnostics.js';
import { generateKeyPairSync } from 'node:crypto';
import { isJavaBlank } from './member-identity.js';

export interface BackendWallet {
  readonly id: string;
  readonly address: string;
  readonly publicKey: string | null;
  readonly chainType: string;
}

export interface BackendWalletCreateRequest {
  readonly chainType: string;
  readonly displayName?: string | null;
  readonly externalId?: string | null;
}

/** 승인키는 EVM 개인키와 다르다. 생성한 키를 지갑 생성 전에 안전하게 영속 보관한다. */
export class BackendWalletRegistration {
  readonly publicKey: string;
  #privateKey: string;

  constructor(publicKey: string, privateKey: string) {
    requireText(publicKey, 'publicKey');
    requireText(privateKey, 'privateKey');
    // Java와 같이 등록 입력 시 곡선이나 공개키/개인키의 일치를 추가 검사하지 않는다.
    this.publicKey = publicKey;
    this.#privateKey = privateKey;
    Object.freeze(this);
  }

  get privateKey(): string { return this.#privateKey; }

  static generate(): BackendWalletRegistration {
    return diagnosticOperation('backend-wallet.generate', undefined, () => {

      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      return new BackendWalletRegistration(
        pair.publicKey.export({ type: 'spki', format: 'pem' }).toString().trimEnd(),
        pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trimEnd(),
      );
    });
  }

  toString(): string { return `BackendWalletRegistration[publicKey=${this.publicKey}, privateKey=[REDACTED]]`; }
  toJSON(): { publicKey: string; privateKey: string } { return { publicKey: this.publicKey, privateKey: '[REDACTED]' }; }
}

export function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || isJavaBlank(value)) throw new TypeError(`${field}는 비공백 문자열이어야 합니다`);
}
