import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DmrvnConfig, DmrvnDeployment } from '../dist/index.js';

import * as DmrvnCrypto from '../dist/dmrvn-crypto.js';

const raw = async name => JSON.parse(await readFile(new URL('../src/resources/dmrvn/' + name, import.meta.url), 'utf8'));
const code = expected => error => { assert.equal(error.code, expected); return true; };
const baseOptions = () => ({ rpcUrl: 'https://node.invalid/rpc?key=synthetic', greenfieldChainId: '5600', bucketName: 'dmrvn',
  objectPrefix: 'partners/101/', partnerId: 101, maxRelayCostWei: 1000000000000000n, confirmations: 1 });

test('raw proxy/direct 및 정규 metadata를 손실 없이 정규화하고 원본과 snapshot을 분리한다', async () => {
  const input = await raw('deployment-testnet.json');
  const deployment = DmrvnDeployment.fromManifest(input);
  const snapshot = deployment.snapshot();
  assert.equal(snapshot.chainId, 421614);
  assert.equal(snapshot.deploymentKind, 'proxy');
  assert.equal(snapshot.contractVersion, '1.0.2');
  assert.deepEqual(snapshot.approvedReleases.map(release => release.contractVersion), ['1.0.0', '1.0.1', '1.0.2']);
  assert.deepEqual({ ...snapshot.approvedReleases.at(-1) }, { address: snapshot.implementationAddress,
    codeHash: snapshot.approvedImplementationHash, contractVersion: '1.0.2' });
  assert.equal(snapshot.contractAddress, input.proxy.toLowerCase());
  assert.equal(Object.hasOwn(snapshot, 'network'), false);
  assert.equal(snapshot.deployment.blockNumber, input.deployment.blockNumber);
  input.codeHashes.proxy = DmrvnCrypto.ZERO_BYTES32;
  snapshot.approvedReleases[0].codeHash = DmrvnCrypto.ZERO_BYTES32;
  assert.notEqual(deployment.snapshot().approvedReleases[0].codeHash, DmrvnCrypto.ZERO_BYTES32);
  assert.deepEqual(DmrvnDeployment.fromManifest(deployment.snapshot()).snapshot(), deployment.snapshot());
  const direct = DmrvnDeployment.historicalDirectTestnet();
  assert.equal(direct.isProxy(), false);
  assert.equal(direct.snapshot().contractVersion, null);
  assert.equal(direct.snapshot().contractVersionSupported, false);
  assert.throws(() => direct.requireWritable(), code('DEPLOYMENT_NOT_READY'));
  assert.doesNotThrow(() => deployment.requireWritable());
});

test('manifest 버전·영값·주소 충돌·승인 릴리스 충돌을 DEPLOYMENT_NOT_READY로 정리한다', async () => {
  const input = await raw('deployment-testnet.json');
  for (const changed of [
    { ...input, chainId: 0 }, { ...input, chainId: '9007199254740992' }, { ...input, domainVersion: 7 },
    { ...input, forwarderDomainVersion: '7' }, { ...input, contractVersion: '1.0.3' },
    { ...input, proxy: '0x' + '00'.repeat(20) }, { ...input, implementation: input.proxy },
    { ...input, codeHashes: { ...input.codeHashes, proxy: DmrvnCrypto.ZERO_BYTES32 } },
    { ...input, approvedReleases: [{ ...input.approvedReleases[0], address: input.forwarder }] },
    { ...input, approvedReleases: [{ ...input.approvedReleases.at(-1), codeHash: input.approvedReleases[0].codeHash }] },
  ]) assert.throws(() => DmrvnDeployment.fromManifest(changed), code('DEPLOYMENT_NOT_READY'));
  const normalized = DmrvnDeployment.testnet().snapshot();
  assert.throws(() => DmrvnDeployment.fromManifest({ ...normalized, approvedImplementationHash: DmrvnCrypto.ZERO_BYTES32 }), code('DEPLOYMENT_NOT_READY'));
  const direct = await raw('deployment-direct-v7-testnet.json');
  assert.throws(() => DmrvnDeployment.fromManifest({ ...direct, contractVersion: '1.0.0' }), code('DEPLOYMENT_NOT_READY'));
  // owner는 다른 배포 주소와의 중복을 별도로 거부하지 않는다.
  assert.doesNotThrow(() => DmrvnDeployment.fromManifest({ ...input, owner: input.proxy }));
});

test('저장된 배포 호환은 identity와 승인 릴리스에 결속하며 모든 metadata 동일성을 요구하지 않는다', () => {
  const deployment = DmrvnDeployment.testnet();
  const saved = deployment.snapshot();
  assert.doesNotThrow(() => deployment.assertCompatible(saved));
  assert.throws(() => deployment.assertCompatible({ ...saved, chainId: 1 }), code('DEPLOYMENT_COLLISION'));
  assert.throws(() => deployment.assertCompatible({ ...saved, approvedImplementationHash: DmrvnCrypto.ZERO_BYTES32 }), code('UNAPPROVED_IMPLEMENTATION'));
  assert.doesNotThrow(() => deployment.assertCompatible({ ...saved, owner: 'changed-field-not-checked' }));
  for (const older of saved.approvedReleases.slice(0, -1)) {
    assert.doesNotThrow(() => deployment.assertCompatible({ ...saved, implementationAddress: older.address,
      approvedImplementationHash: older.codeHash, contractVersion: older.contractVersion }));
  }
});

test('config는 배포 identity와 파트너·저장소·비용을 검증하고 양의 큰 비용 상한을 허용한다', () => {
  const deployment = DmrvnDeployment.testnet();
  const config = DmrvnConfig.fromDeployment(deployment, { ...baseOptions(), maxRelayCostWei: 1n << 300n });
  assert.equal(config.deploymentId(), '421614:' + deployment.contractAddress());
  assert.equal(config.maxRelayCostWei, 1n << 300n);
  assert.ok(Object.isFrozen(config));
  assert.equal(DmrvnConfig.petTestnet(101, 'partners/101/', 1n).greenfieldChainId, '5600');
  const values = { ...config };
  assert.throws(() => new DmrvnConfig({ ...values, chainId: 1 }), code('DEPLOYMENT_NOT_READY'));
  assert.throws(() => new DmrvnConfig({ ...values, claimAddress: config.forwarderAddress }), code('DEPLOYMENT_NOT_READY'));
  for (const extra of [{ partnerId: 0 }, { partnerId: 4294967296 }, { confirmations: 0 }, { confirmations: 2147483648 },
    { maxRelayCostWei: 0n }, { greenfieldChainId: '05600' }, { greenfieldChainId: 5600 }, { bucketName: 'UPPER' },
    { objectPrefix: '/root/' }, { objectPrefix: 'a/../' }, { objectPrefix: 'no-final-slash' }, { rpcUrl: 'http://REMOTE' }]) {
    assert.throws(() => DmrvnConfig.fromDeployment(deployment, { ...baseOptions(), ...extra }), code('INVALID_INPUT'));
  }
});

test('object는 prefix·UTF8 1024바이트·제어 문자·..를 검사하며 prefix 검사는 별도 경계다', () => {
  const config = DmrvnConfig.petTestnet(101, 'partners/101/', 1n);
  assert.doesNotThrow(() => config.checkObject('partners/101/' + 'x'.repeat(1024 - 'partners/101/'.length)));
  for (const name of ['partners/101/', 'other/file', 'partners/101/..x', 'partners/101/\u0085',
    'partners/101/' + '한'.repeat(400)]) assert.throws(() => config.checkObject(name), code('INVALID_INPUT'));
  const prefixOnly = DmrvnConfig.petTestnet(101, 'prefix\u0000/', 1n);
  assert.throws(() => prefixOnly.checkObject('prefix\u0000/file'), code('INVALID_INPUT'));
});
