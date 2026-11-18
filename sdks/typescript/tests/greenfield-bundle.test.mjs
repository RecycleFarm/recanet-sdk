import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NodeGreenfieldStorage } from '../dist/index.js';



test('동봉 공식 worker는 고정 의존성을 실제 로드하고 키/주소 불일치 시 RPC 전에 정리된 protocol로 거부한다', async t => {
  const metadata = async path => JSON.parse(await readFile(new URL('../tools/greenfield/node_modules/' + path + '/package.json', import.meta.url), 'utf8'));
  assert.equal((await metadata('@bnb-chain/greenfield-js-sdk')).version, '2.2.2');
  assert.equal((await metadata('ethers')).version, '5.8.0');
  const variable = 'RECANET_BUNDLED_TEST_STORAGE_KEY', original = process.env[variable];
  process.env[variable] = '0x' + '00'.repeat(31) + '01'; // 고정 공개 시험키, 실제 계정 아님.
  t.after(() => { if (original === undefined) delete process.env[variable]; else process.env[variable] = original; });
  const storage = new NodeGreenfieldStorage({ rpcUrl: 'https://not-contacted.invalid', chainId: '5600',
    address: '0x' + 'ab'.repeat(20), keyEnvironmentVariable: variable, timeoutMs: 5000 });
  await assert.rejects(() => storage.head({ storageType: 1, chainId: '5600', bucketName: 'test', objectName: 'evidence.json' }),
    error => error.code === 'STORAGE_ACCESS_DENIED' && !error.definitelyNotBroadcast && !String(error).includes(process.env[variable]));
});
