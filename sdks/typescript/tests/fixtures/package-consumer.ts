import {
  ActivityRequest, BackendWalletRegistration, DmrvnAbi, DmrvnCrypto, FileOperationJournal,
  DeclaredMethodology, DmrvnClient, DmrvnJson, EvmTransactionClient, PrivyClient, memberExternalId, type UserWalletClient,
} from 'recanet-typescript';

const client = new PrivyClient({ appId: 'offline-test', appSecret: 'offline-test' });
const exporter: (id: string, key: BackendWalletRegistration) => Promise<string> = client.exportWalletPrivateKey.bind(client);
void exporter; // Type-check only: no service request or key export.
const transactions = new EvmTransactionClient(1, { async call() { throw new Error('type-check only'); } });
const list: (address: string, limit: number, cursor?: string | null, signal?: AbortSignal) => ReturnType<EvmTransactionClient['listTransactions']>
  = transactions.listTransactions.bind(transactions);
void list;
function memberActivityTypes(sdk: DmrvnClient, members: UserWalletClient, signal: AbortSignal) {
  const outcome: Promise<Record<string, unknown>> = sdk.submitActivity(members, 'user', 'operation',
    '0x' + '11'.repeat(32), 'evidence.json', {}, '100000', signal);
  return outcome;
}
void memberActivityTypes;
const petFactory: (manifest: Uint8Array, wasm: Uint8Array, hash: string,
  registry: (activity: number, id: number, version: number, hash: string) => Promise<boolean>) => DeclaredMethodology
  = DeclaredMethodology.petV3;
void petFactory;
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
// 합성 패키지 소비자용 manifest. 운영 PET 패키지가 아니다.
const manifest = { activityId: 1003, methodology: { id: 2003, version: 3 }, wasmHash: DmrvnCrypto.keccak(wasm) };
const pet = DeclaredMethodology.petV3(DmrvnJson.bytes(manifest), wasm, DmrvnJson.hash(manifest), () => true);
const body = pet.evidenceBody(101, '0x' + '11'.repeat(20), 'consumer', { petBottleCount: 3 });
if (body.schemaVersion !== 4 || pet.version() !== 3) throw new Error('PET v3 profile');
const object: Record<string, unknown> = DmrvnJson.object(Buffer.from('{"value":1}'));
if (object.value !== 1) throw new Error('object JSON parser');
const request = new ActivityRequest('user', 'event', {});
if (request.gas !== '900000') throw new Error('ActivityRequest defaults');
if (memberExternalId('service', 'user').length === 0) throw new Error('member ID');
if (DmrvnAbi.CLAIM.topic('submitClaim').length !== 66) throw new Error('ABI resource');
if (DmrvnCrypto.textHash('value').length !== 66) throw new Error('Keccak');
const journal = new FileOperationJournal('./journal');
await journal.withLock('state', async () => { await journal.store('state', { value: 9007199254740991 }); });
if ((await new FileOperationJournal('./journal').load('state'))?.value !== 9007199254740991) throw new Error('native journal');
console.log('packed consumer smoke passed');
