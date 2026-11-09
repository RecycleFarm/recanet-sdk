import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { DeclaredMethodology, DmrvnClient, DmrvnCrypto, DmrvnJson, MemoryOperationJournal } from '../../dist/index.js';
import { chainFixture, address } from './dmrvn-chain.mjs';
import { petV3Methodology } from './evidence-v4.mjs';

/** 고정 공개 시험키 2. 외부 계정/자금과 무관한 가짜 의존성이다. */
export function workflowFixture(journal = new MemoryOperationJournal(), { petV3 = false } = {}) {
  const chain = chainFixture();
  const wallet = new Wallet('0x' + '00'.repeat(31) + '02');
  const beneficiary = new Wallet('0x' + '00'.repeat(31) + '01').address.toLowerCase();
  const counts = { messages: 0, typed: 0, creates: 0, uploads: 0, heads: 0, reads: 0, proofs: 0, registry: 0 };
  const objects = new Map();
  const status = { active: true, sealOnUpload: true };
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = { activityId: 1003, methodology: { id: 2003, version: 1 }, wasmHash: DmrvnCrypto.keccak(wasm) };
  const registry = () => { counts.registry++; return status.active; };
  const methodology = petV3 ? petV3Methodology(registry).methodology
    : new DeclaredMethodology(DmrvnJson.bytes(manifest), wasm, DmrvnJson.hash(manifest), registry, 999);
  const operator = { address: wallet.address, async signMessage(text) { counts.messages++; return wallet.signMessage(text); },
    async signTypedData(typed) {
      counts.typed++; const types = { ...typed.types }; delete types.EIP712Domain;
      return wallet.signTypedData(typed.domain, types, typed.message);
    }, async sendTransaction() { assert.fail('Evidence 단계에서 거래를 제출하지 않는다'); } };
  const storage = { address: address('b'), chainId: '5600',
    async head(location) { counts.heads++; const value = objects.get(location.objectName); return { exists: !!value, sealed: !!value?.sealed }; },
    async create(location, bytes) {
      counts.creates++;
      const hash = '0x' + counts.creates.toString(16).padStart(64, '0');
      objects.set(location.objectName, { bytes: Uint8Array.from(bytes), hash, sealed: false }); return hash;
    },
    async upload(location, bytes, hash) {
      counts.uploads++; const value = objects.get(location.objectName); assert.ok(value);
      assert.equal(hash, value.hash); assert.deepEqual([...bytes], [...value.bytes]); value.sealed = status.sealOnUpload;
    },
    async read(location) { counts.reads++; return Uint8Array.from(objects.get(location.objectName).bytes); },
    async matchesCreateTransaction(location, hash) { counts.proofs++; return objects.get(location.objectName)?.hash === hash; },
  };
  const client = new DmrvnClient(chain.config, chain.rpc, operator, storage, methodology, journal);
  const claimId = '0x' + '11'.repeat(32);
  const objectName = 'partners/101/evidence.json';
  const body = methodology.evidenceBody(101, beneficiary, 'source-event', petV3 ? { petBottleCount: 3 } : { arbitraryInput: [3, 'kg'] });
  const prepare = (operation = 'operation-one', claim = claimId, object = objectName, evidence = body) =>
    client.prepareEvidence(operation, claim, beneficiary, object, evidence);
  return { ...chain, client, methodology, operator, storage, journal, wallet, beneficiary, counts, objects, status, body, claimId, objectName, prepare };
}
