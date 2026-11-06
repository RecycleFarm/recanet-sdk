import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DmrvnAbi, DmrvnChain, DmrvnCrypto, DmrvnError, IMPLEMENTATION_SLOT, ADMIN_SLOT } from '../dist/index.js';
import { chainFixture, address } from './helpers/dmrvn-chain.mjs';

const code = expected => error => { assert.equal(error.code, expected); assert.equal(error.cause, undefined); return true; };

test('proxy의 slot·승인 release·code/version/owner/domain을 한 블록에서 확인한다', async () => {
  const fixture = chainFixture();
  const chain = new DmrvnChain(fixture.config, fixture.rpc);
  const first = await chain.verifyDeployment();
  assert.equal(first.verified, true);
  assert.equal(first.observedBlock, 100n);
  assert.equal(first.observedBlockHash, fixture.state.blockHash);
  assert.equal(first.contractVersion, '1.0.0');
  assert.equal(fixture.calls.filter(call => call.method === 'eth_getCode').length, 4);
  assert.equal(fixture.calls.filter(call => call.method === 'eth_getStorageAt').length, 2);
  for (const call of fixture.calls.filter(call => ['eth_call', 'eth_getCode', 'eth_getStorageAt'].includes(call.method))) {
    assert.equal(call.params.at(-1), '0x64');
  }
  fixture.state.implementation = fixture.second;
  fixture.state.version = '1.0.1';
  const next = await chain.verifyDeployment(100);
  assert.equal(next.implementationAddress, fixture.second);
  assert.equal(next.contractVersion, '1.0.1');
  assert.equal(fixture.config.deployment.snapshot().implementationAddress, fixture.first);
  fixture.config.deployment.assertCompatible(first);
  assert.equal(first.contractVersion, '1.0.0');
});

test('proxy의 코드·slot·version·owner·domain·trusted·reorg 불일치를 올바른 오류로 구분한다', async () => {
  for (const variant of ['chain', 'proxy-code', 'forwarder-code', 'admin-code', 'implementation-code', 'implementation-slot', 'admin-slot',
    'slot-padding', 'empty-code', 'version', 'owner', 'claim-domain', 'forwarder-domain', 'domain-name', 'domain-chain',
    'domain-verifier', 'domain-fields', 'domain-salt', 'domain-extensions', 'trusted', 'rpc', 'reorg']) {
    const item = chainFixture();
    let blocks = 0;
    const rpc = { async call(method, params) {
      if (variant === 'rpc') throw new DmrvnError('RPC_UNAVAILABLE');
      if (variant === 'chain' && method === 'eth_chainId') return '0x1';
      if (variant === 'reorg' && method === 'eth_getBlockByNumber' && ++blocks === 2) return { hash: DmrvnCrypto.ZERO_BYTES32 };
      if (method === 'eth_getCode') {
        const target = { 'proxy-code': item.target, 'forwarder-code': item.forwarder, 'admin-code': item.admin,
          'implementation-code': item.state.implementation, 'empty-code': item.target }[variant];
        if (params[0] === target) return variant === 'empty-code' ? '0x' : '0x02';
      }
      if (method === 'eth_getStorageAt') {
        if (variant === 'slot-padding') return '0x01' + '00'.repeat(31);
        if ((variant === 'implementation-slot' && params[1] === IMPLEMENTATION_SLOT)
          || (variant === 'admin-slot' && params[1] === ADMIN_SLOT)) return '0x' + '00'.repeat(12) + '77'.repeat(20);
      }
      const original = await item.rpc.call(method, params);
      if (method !== 'eth_call') return original;
      const tx = params[0];
      if (tx.to === item.admin) {
        return variant === 'owner' ? item.result(DmrvnAbi.PROXY_ADMIN, 'owner', { '': item.first }) : original;
      }
      const forward = tx.to === item.forwarder;
      const abi = forward ? DmrvnAbi.FORWARDER : DmrvnAbi.CLAIM;
      if (tx.data.startsWith(abi.topic('eip712Domain').slice(0, 10))) {
        const domain = abi.decodeOutput('eip712Domain', original);
        if (variant === 'claim-domain' && !forward) domain.version = '1.0.1';
        if (variant === 'forwarder-domain' && forward) domain.version = '7';
        if (variant === 'domain-name') domain.name = 'Other';
        if (variant === 'domain-chain') domain.chainId = '1';
        if (variant === 'domain-verifier') domain.verifyingContract = item.first;
        if (variant === 'domain-fields') domain.fields = '0x00';
        if (variant === 'domain-salt') domain.salt = '0x' + '11'.repeat(32);
        if (variant === 'domain-extensions') domain.extensions = ['1'];
        return item.result(abi, 'eip712Domain', domain);
      }
      if (!forward && variant === 'version' && tx.data.startsWith(abi.topic('contractVersion').slice(0, 10))) return item.result(abi, 'contractVersion', { '': '1.0.1' });
      if (!forward && variant === 'trusted' && tx.data.startsWith(abi.topic('isTrustedForwarder').slice(0, 10))) return item.result(abi, 'isTrustedForwarder', { '': false });
      return original;
    } };
    await assert.rejects(new DmrvnChain(item.config, rpc).verifyDeployment(),
      code(variant.startsWith('implementation-') || variant === 'version' ? 'UNAPPROVED_IMPLEMENTATION' : 'DEPLOYMENT_NOT_READY'), variant);
  }
});

test('direct는 코드/domain 검증을 지원하지만 proxy slot/owner/version을 조회하지 않는다', async () => {
  const fixture = chainFixture(false);
  const observed = await new DmrvnChain(fixture.config, fixture.rpc).verifyDeployment(100n);
  assert.equal(observed.contractVersion, null);
  assert.equal(observed.contractVersionSupported, false);
  assert.equal(fixture.calls.filter(call => call.method === 'eth_getStorageAt').length, 0);
  assert.equal(fixture.calls.filter(call => call.method === 'eth_getCode').length, 2);
  assert.equal(fixture.calls.filter(call => call.method === 'eth_call').length, 3);
});

test('Chain의 quantity·confirmed head·nonce·role 경계는 일반 거래 조회와 구분된다', async () => {
  assert.equal(DmrvnChain.number('0x0001'), 1n);
  assert.equal(DmrvnChain.number('0x' + 'f'.repeat(65)), (1n << 260n) - 1n);
  assert.throws(() => DmrvnChain.number('0X1'), code('RPC_UNAVAILABLE'));
  const fixture = chainFixture(true, 200);
  const chain = new DmrvnChain(fixture.config, fixture.rpc);
  assert.equal(await chain.confirmedHead(), 0n);
  assert.equal(await chain.timestamp(), 0x123n);
  assert.equal(await chain.nonce(address('a'), true), 9007199254740993n);
  await chain.verifyApprover(address('a'));
  fixture.state.role = false;
  await assert.rejects(chain.verifyApprover(address('a')), code('UNAUTHORIZED_SIGNER'));
  const failed = new DmrvnChain(fixture.config, { async call() { throw new DmrvnError('GAS_ESTIMATION_FAILED'); } });
  await assert.rejects(failed.contract(DmrvnAbi.CLAIM, fixture.target, 'paused', {}, 'latest'), code('RPC_UNAVAILABLE'));
});

test('배포 관찰은 입력 block number를 추가 대조하지 않고 최종 raw hash의 대소문자 차이를 거부한다', async () => {
  const fixture = chainFixture();
  const changedNumber = { async call(method, params) {
    const result = await fixture.rpc.call(method, params);
    return method === 'eth_getBlockByNumber' ? { ...result, number: '0x1' } : result;
  } };
  assert.equal((await new DmrvnChain(fixture.config, changedNumber).verifyDeployment()).verified, true);
  let blocks = 0;
  const uppercase = { async call(method, params) {
    const result = await fixture.rpc.call(method, params);
    return method === 'eth_getBlockByNumber' && ++blocks === 2 ? { ...result, hash: '0x' + result.hash.slice(2).toUpperCase() } : result;
  } };
  await assert.rejects(new DmrvnChain(fixture.config, uppercase).verifyDeployment(), code('DEPLOYMENT_NOT_READY'));
  await assert.rejects(new DmrvnChain(fixture.config, fixture.rpc).verifyDeployment(undefined, AbortSignal.abort()), code('DEPLOYMENT_NOT_READY'));
});
