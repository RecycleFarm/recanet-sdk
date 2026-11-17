import testnet from './resources/dmrvn/deployment-testnet.json' with { type: 'json' };
import historical from './resources/dmrvn/deployment-direct-v7-testnet.json' with { type: 'json' };
import { bytes32, normalizeAddress, uint, ZERO_BYTES32 } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnError } from './errors.js';

function requireValue(condition: boolean): asserts condition { if (!condition) throw new DmrvnError('INVALID_INPUT'); }
function map(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  return value as Record<string, unknown>;
}
function str(value: unknown): string { requireValue(typeof value === 'string'); return value; }
function copy(value: unknown): Record<string, unknown> { return map(DmrvnJson.copy(value)); }
export function deploymentAddress(value: unknown): string {
  const result = normalizeAddress(str(value));
  requireValue(result !== '0x' + '00'.repeat(20));
  return result;
}
function codeHash(value: unknown): string {
  const result = bytes32(str(value));
  requireValue(result !== ZERO_BYTES32);
  return result;
}

/** 승인된 manifest 설정. 후보 implementation은 실제 체인 관찰과 구분한다. */
export class DmrvnDeployment {
  #metadata: Record<string, unknown>;
  private constructor(metadata: Record<string, unknown>) { this.#metadata = copy(metadata); }

  static fromManifest(input: Readonly<Record<string, unknown>>): DmrvnDeployment {
    try {
      const m = copy(input);
      const chain = uint(m.chainId, 53);
      requireValue(chain > 0n);
      const normalized = Object.hasOwn(m, 'contractAddress');
      const proxy = normalized ? m.deploymentKind === 'proxy' : Object.hasOwn(m, 'proxy');
      if (normalized) requireValue(proxy || m.deploymentKind === 'direct');
      else if (Object.hasOwn(m, 'deploymentKind')) requireValue((proxy ? ['proxy', 'transparent-proxy'] : ['direct']).includes(str(m.deploymentKind)));
      const contract = normalized || proxy ? m : map(m.contract);
      const forwarder = normalized || proxy ? m : map(m.forwarder);
      requireValue((normalized ? m.protocolVersion : contract.domainVersion) === '7');
      if (Object.hasOwn(m, 'domainVersion')) requireValue(m.domainVersion === '7');
      if (Object.hasOwn(m, 'forwarderDomainVersion')) requireValue(m.forwarderDomainVersion === '1');
      if (!normalized && !proxy) requireValue(forwarder.domainVersion === '1');
      const target = deploymentAddress(normalized ? m.contractAddress : proxy ? m.proxy : contract.address);
      const fwd = deploymentAddress(normalized ? m.forwarderAddress : proxy ? m.forwarder : forwarder.address);
      const hashes = normalized || proxy ? copy(map(m.codeHashes)) : { contract: contract.runtimeCodeHash, forwarder: forwarder.runtimeCodeHash };
      for (const key of proxy ? ['proxy', 'implementation', 'forwarder', 'proxyAdmin'] : ['contract', 'forwarder']) hashes[key] = codeHash(hashes[key]);
      const result: Record<string, unknown> = { chainId: Number(chain), contractAddress: target, forwarderAddress: fwd,
        protocolVersion: '7', domainVersion: '7', forwarderDomainVersion: '1', deploymentKind: proxy ? 'proxy' : 'direct',
        contractVersion: null, contractVersionSupported: proxy, codeHashes: hashes };
      if (proxy) {
        const implementation = deploymentAddress(m[normalized ? 'implementationAddress' : 'implementation']);
        const admin = deploymentAddress(m[normalized ? 'proxyAdminAddress' : 'proxyAdmin']);
        const implementationHash = codeHash(normalized ? m.approvedImplementationHash : hashes.implementation);
        requireValue(implementationHash === hashes.implementation && new Set([target, fwd, implementation, admin]).size === 4);
        const releases: unknown[] = [];
        if (Object.hasOwn(m, 'approvedReleases')) { requireValue(Array.isArray(m.approvedReleases)); releases.push(...m.approvedReleases); }
        releases.push({ address: implementation, codeHash: implementationHash, contractVersion: m.contractVersion });
        const approved = new Map<string, Record<string, unknown>>();
        for (const raw of releases) {
          const release = map(raw);
          const addr = deploymentAddress(release.address);
          const version = str(release.contractVersion);
          requireValue(['1.0.0', '1.0.1'].includes(version) && ![target, fwd, admin].includes(addr));
          const value = { address: addr, codeHash: codeHash(release.codeHash), contractVersion: version };
          requireValue(!approved.has(addr) || DmrvnJson.canonical(approved.get(addr)) === DmrvnJson.canonical(value));
          approved.set(addr, value);
        }
        Object.assign(result, { implementationAddress: implementation, proxyAdminAddress: admin, owner: deploymentAddress(m.owner),
          approvedImplementationHash: implementationHash, contractVersion: m.contractVersion, approvedReleases: [...approved.values()] });
      } else requireValue(m.contractVersion == null && m.implementationAddress == null);
      if (Object.hasOwn(m, 'deployment')) result.deployment = copy(map(m.deployment));
      return new DmrvnDeployment(result);
    } catch { throw new DmrvnError('DEPLOYMENT_NOT_READY'); }
  }

  static testnet(): DmrvnDeployment { return this.fromManifest(testnet); }
  static historicalDirectTestnet(): DmrvnDeployment { return this.fromManifest(historical); }
  snapshot(): Record<string, unknown> { return copy(this.#metadata); }
  chainId(): number { return this.#metadata.chainId as number; }
  contractAddress(): string { return str(this.#metadata.contractAddress); }
  forwarderAddress(): string { return str(this.#metadata.forwarderAddress); }
  isProxy(): boolean { return this.#metadata.deploymentKind === 'proxy'; }
  runtimeCodeHash(): string { return str(map(this.#metadata.codeHashes)[this.isProxy() ? 'proxy' : 'contract']); }
  requireWritable(): void { if (!this.isProxy()) throw new DmrvnError('DEPLOYMENT_NOT_READY'); }
  release(address: string): Record<string, unknown> | null {
    if (!this.isProxy()) return null;
    const result = (this.#metadata.approvedReleases as Record<string, unknown>[]).find(value => value.address === address);
    return result ? copy(result) : null;
  }
  assertCompatible(saved: Readonly<Record<string, unknown>>): void {
    for (const field of ['chainId', 'contractAddress', 'forwarderAddress', 'protocolVersion', 'deploymentKind']) {
      if (String(this.#metadata[field]) !== String(saved[field])) throw new DmrvnError('DEPLOYMENT_COLLISION');
    }
    if (this.isProxy()) {
      const release = this.release(str(saved.implementationAddress));
      if (!release || release.codeHash !== saved.approvedImplementationHash || release.contractVersion !== saved.contractVersion) {
        throw new DmrvnError('UNAPPROVED_IMPLEMENTATION');
      }
    }
  }
}
