import { diagnosticOperation } from '../diagnostics.js';
import { BackendWalletRegistration, requireText } from '../backend-wallet.js';
import { PrivyApiError } from '../errors.js';
import { prepareAuthorization } from './authorization.js';
import { requestJson, type HttpSettings } from './http.js';
import { createExportReceiver } from './privy-hpke.js';

/** Returns the decrypted blockchain secret directly; no persistence, output or wallet lookup. */
export async function exportWalletPrivateKey(settings: HttpSettings, walletId: string, registration: BackendWalletRegistration,
  signal?: AbortSignal): Promise<string> {
  return diagnosticOperation('wallet-export.exportWalletPrivateKey', undefined, async () => {
    requireText(walletId, 'walletId');
    if (!(registration instanceof BackendWalletRegistration)) throw new TypeError('등록 승인키가 필요합니다');
    try {
      const receiver = await createExportReceiver();
      const path = '/v1/wallets/' + encodeURIComponent(walletId) + '/export';
      const body = { encryption_type: 'HPKE', recipient_public_key: receiver.recipientPublicKey };
      const signed = prepareAuthorization(settings.appId, settings.origin + path, body, registration.privateKey);
      const response = await requestJson(settings, path, 'POST', undefined, signal, 200, signed);
      if (!response || typeof response !== 'object' || !('encapsulated_key' in response) || typeof response.encapsulated_key !== 'string'
        || !('ciphertext' in response) || typeof response.ciphertext !== 'string') throw new Error();
      // The pinned Java helper does not select a suite from response.encryption_type.
      return await receiver.open(response.encapsulated_key, response.ciphertext);
    } catch (error) {
      throw error instanceof PrivyApiError ? error : new PrivyApiError('UNAVAILABLE', 0);
    }
  });
}
