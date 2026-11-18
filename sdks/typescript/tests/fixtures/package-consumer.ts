import {
  ActivityRequest, BackendWalletRegistration, FileOperationJournal,
  DeclaredMethodology, DmrvnClient, Json, EvmTransactionClient, PrivyClient, PrivyClientConfig, Duration, EvmTransactionQuery, DmrvnProtocol, type UserWalletClient,
} from '@recyclefarm/recanet-sdk';

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
const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
// 합성 패키지 소비자용 manifest. 운영 PET 패키지가 아니다.
const manifest = { activityId: 1003, methodology: { id: 2003, version: 3 }, wasmHash: '0xdca3676eb137c0de909fa86423cce7b2e91614ee6b739ee7514b1095382eee30' };
const pet = new DeclaredMethodology(Json.bytes(manifest), wasm, Json.hash(manifest), () => true, 4);
const body = pet.evidenceBody(101, '0x' + '11'.repeat(20), 'consumer', { petBottleCount: 3 });
if (body.schemaVersion !== 4 || pet.version() !== 3) throw new Error('PET v3 profile');
const object: Record<string, unknown> = Json.object(Buffer.from('{"value":1}'));
if (object.value !== 1) throw new Error('object JSON parser');
const request = new ActivityRequest('user', 'event', {});
if (request.gas !== '900000') throw new Error('ActivityRequest defaults');
const config = new PrivyClientConfig('app','secret','https://api.privy.io',Duration.ofMillis(9223372036854775807n));
if (new PrivyClient(config).config().requestTimeout().toMillis() !== 9223372036854775807n) throw new Error('duration/config parity');
if (new EvmTransactionQuery(0n,null,20).withCursor('next').cursor !== 'next') throw new Error('query binding');
if (DmrvnProtocol.ownerHash('0x'+'11'.repeat(20)).length !== 66) throw new Error('protocol');
const journal = new FileOperationJournal('./journal');
await journal.withLock('state', async () => { await journal.store('state', { value: 9007199254740991 }); });
if ((await new FileOperationJournal('./journal').load('state'))?.value !== 9007199254740991) throw new Error('native journal');
console.log('packed consumer smoke passed');
