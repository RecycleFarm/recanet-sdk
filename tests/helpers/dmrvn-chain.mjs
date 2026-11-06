import { DmrvnAbi, DmrvnConfig, DmrvnCrypto as crypto, DmrvnDeployment, IMPLEMENTATION_SLOT } from '../../dist/index.js';

export const address = digit => '0x' + digit.repeat(40);
export function chainFixture(proxy = true, confirmations = 1) {
  const target = address('1'), forwarder = address('2'), first = address('3'), admin = address('4'), owner = address('5'), second = address('6');
  const code = { [target]: '0x6001', [forwarder]: '0x6002', [first]: '0x6003', [admin]: '0x6004', [second]: '0x6005' };
  const hash = who => crypto.keccak(crypto.hexBytes(code[who]));
  const manifest = proxy ? { chainId: 421614, domainVersion: '7', forwarderDomainVersion: '1', contractVersion: '1.0.0',
    proxy: target, implementation: first, proxyAdmin: admin, owner, forwarder,
    codeHashes: { proxy: hash(target), implementation: hash(first), proxyAdmin: hash(admin), forwarder: hash(forwarder) },
    approvedReleases: [{ address: first, codeHash: hash(first), contractVersion: '1.0.0' },
      { address: second, codeHash: hash(second), contractVersion: '1.0.1' }] }
    : { chainId: 421614, contract: { address: target, domainVersion: '7', runtimeCodeHash: hash(target) },
      forwarder: { address: forwarder, domainVersion: '1', runtimeCodeHash: hash(forwarder) } };
  const deployment = DmrvnDeployment.fromManifest(manifest);
  const config = DmrvnConfig.fromDeployment(deployment, { rpcUrl: 'https://node.invalid', greenfieldChainId: '5600',
    bucketName: 'dmrvn', objectPrefix: 'partners/101/', partnerId: 101, maxRelayCostWei: 1000000000000000n, confirmations });
  const state = { implementation: first, version: '1.0.0', head: 100n, blockHash: '0x' + 'ab'.repeat(32), role: true, balance: '0x0',
    timestamp: 291n, claimNonce: '9007199254740993', forwardNonce: '9007199254740993' };
  const calls = [];
  const result = (abi, fn, value) => DmrvnAbi.encodeTuple(abi.outputs(fn), value);
  const rpc = { async call(method, params) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return '0x66eee';
    if (method === 'eth_blockNumber') return '0x' + state.head.toString(16);
    if (method === 'eth_getBlockByNumber') return { hash: state.blockHash, number: '0x64', timestamp: '0x' + state.timestamp.toString(16) };
    if (method === 'eth_getCode') return code[params[0]];
    if (method === 'eth_getStorageAt') return '0x' + '00'.repeat(12) + (params[1] === IMPLEMENTATION_SLOT ? state.implementation : admin).slice(2);
    if (method === 'eth_getBalance') return state.balance;
    if (method === 'eth_call') {
      const tx = params[0];
      if (tx.to === admin) return result(DmrvnAbi.PROXY_ADMIN, 'owner', { '': owner });
      const abi = tx.to === forwarder ? DmrvnAbi.FORWARDER : DmrvnAbi.CLAIM;
      const matches = fn => tx.data.startsWith(abi.topic(fn).slice(0, 10));
      if (matches('eip712Domain')) return result(abi, 'eip712Domain', { fields: '0x0f', name: tx.to === forwarder ? 'DMRVNForwarder' : 'DMRVNClaimContract',
        version: tx.to === forwarder ? '1' : '7', chainId: '421614', verifyingContract: tx.to, salt: crypto.ZERO_BYTES32, extensions: [] });
      if (tx.to !== forwarder && matches('contractVersion')) return result(abi, 'contractVersion', { '': state.version });
      if (tx.to !== forwarder && matches('isTrustedForwarder')) return result(abi, 'isTrustedForwarder', { '': true });
      if (tx.to !== forwarder && matches('CLAIM_APPROVER_ROLE')) return result(abi, 'CLAIM_APPROVER_ROLE', { '': crypto.textHash('CLAIM_APPROVER_ROLE') });
      if (tx.to !== forwarder && matches('hasRole')) return result(abi, 'hasRole', { '': state.role });
      if (matches('nonces')) return result(abi, 'nonces', { '': tx.to === forwarder ? state.forwardNonce : state.claimNonce });
    }
    throw new Error('Unexpected test RPC ' + method);
  } };
  return { config, manifest, state, calls, rpc, code, target, forwarder, first, second, admin, owner, result };
}
