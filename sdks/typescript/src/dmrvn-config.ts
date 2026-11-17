import { bytes32, javaUtf8, normalizeAddress, uint } from './dmrvn-crypto.js';
import { DmrvnDeployment } from './dmrvn-deployment.js';
import { DmrvnError } from './errors.js';
import { dmrvnUri } from './internal/dmrvn-uri.js';
import { isJavaBlank } from './member-identity.js';

export interface DmrvnConfigOptions {
  readonly chainId: number | bigint;
  readonly rpcUrl: string;
  readonly claimAddress: string;
  readonly forwarderAddress: string;
  readonly claimRuntimeCodeHash: string;
  readonly greenfieldChainId: string;
  readonly bucketName: string;
  readonly objectPrefix: string;
  readonly partnerId: number;
  readonly maxRelayCostWei: bigint;
  readonly confirmations: number;
  readonly deployment: DmrvnDeployment;
}
export type DeploymentConfigOptions = Omit<DmrvnConfigOptions, 'chainId' | 'claimAddress' | 'forwarderAddress' | 'claimRuntimeCodeHash' | 'deployment'>;

/** 쓰기 비용 한도·파트너/저장소 범위와 승인 배포를 명시적으로 결속한다. */
export class DmrvnConfig implements DmrvnConfigOptions {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly claimAddress: string;
  readonly forwarderAddress: string;
  readonly claimRuntimeCodeHash: string;
  readonly greenfieldChainId: string;
  readonly bucketName: string;
  readonly objectPrefix: string;
  readonly partnerId: number;
  readonly maxRelayCostWei: bigint;
  readonly confirmations: number;
  readonly deployment: DmrvnDeployment;

  constructor(options: DmrvnConfigOptions) {
    const chain = uint(options.chainId, 53);
    if (chain === 0n) throw new DmrvnError('INVALID_INPUT');
    this.chainId = Number(chain);
    this.rpcUrl = dmrvnUri(options.rpcUrl);
    this.claimAddress = normalizeAddress(options.claimAddress);
    this.forwarderAddress = normalizeAddress(options.forwarderAddress);
    this.claimRuntimeCodeHash = bytes32(options.claimRuntimeCodeHash);
    this.deployment = options.deployment;
    if (!(this.deployment instanceof DmrvnDeployment) || this.deployment.chainId() !== this.chainId
      || this.deployment.contractAddress() !== this.claimAddress || this.deployment.forwarderAddress() !== this.forwarderAddress
      || this.deployment.runtimeCodeHash() !== this.claimRuntimeCodeHash) throw new DmrvnError('DEPLOYMENT_NOT_READY');
    if (typeof options.greenfieldChainId !== 'string') throw new DmrvnError('INVALID_INPUT');
    uint(options.greenfieldChainId, 64);
    this.greenfieldChainId = options.greenfieldChainId;
    if (typeof options.bucketName !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucketName)
      || typeof options.objectPrefix !== 'string' || isJavaBlank(options.objectPrefix) || !options.objectPrefix.endsWith('/')
      || options.objectPrefix.startsWith('/') || options.objectPrefix.includes('..') || !Number.isInteger(options.partnerId)
      || options.partnerId < 1 || options.partnerId > 0xffffffff || typeof options.maxRelayCostWei !== 'bigint' || options.maxRelayCostWei <= 0n
      || !Number.isInteger(options.confirmations) || options.confirmations < 1 || options.confirmations > 2147483647) throw new DmrvnError('INVALID_INPUT');
    this.bucketName = options.bucketName; this.objectPrefix = options.objectPrefix; this.partnerId = options.partnerId;
    this.maxRelayCostWei = options.maxRelayCostWei; this.confirmations = options.confirmations;
    Object.freeze(this);
  }
  static fromDeployment(deployment: DmrvnDeployment, options: DeploymentConfigOptions): DmrvnConfig {
    return new DmrvnConfig({ ...options, deployment, chainId: deployment.chainId(), claimAddress: deployment.contractAddress(),
      forwarderAddress: deployment.forwarderAddress(), claimRuntimeCodeHash: deployment.runtimeCodeHash() });
  }
  static petTestnet(partnerId: number, objectPrefix: string, maxRelayCostWei: bigint): DmrvnConfig {
    return this.testnet(DmrvnDeployment.testnet(), partnerId, objectPrefix, maxRelayCostWei);
  }
  static historicalDirectTestnet(partnerId: number, objectPrefix: string, maxRelayCostWei: bigint): DmrvnConfig {
    return this.testnet(DmrvnDeployment.historicalDirectTestnet(), partnerId, objectPrefix, maxRelayCostWei);
  }
  private static testnet(deployment: DmrvnDeployment, partnerId: number, objectPrefix: string, maxRelayCostWei: bigint): DmrvnConfig {
    return this.fromDeployment(deployment, { rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc', greenfieldChainId: '5600',
      bucketName: 'dmrvn', objectPrefix, partnerId, maxRelayCostWei, confirmations: 1 });
  }
  deploymentId(): string { return this.chainId + ':' + this.claimAddress; }
  checkObject(name: string): void {
    if (typeof name !== 'string' || !name.startsWith(this.objectPrefix) || name.length <= this.objectPrefix.length
      || javaUtf8(name).length > 1024 || name.includes('..') || /[\x00-\x1f\x7f-\x9f]/.test(name)) throw new DmrvnError('INVALID_INPUT');
  }
}
