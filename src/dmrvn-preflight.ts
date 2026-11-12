import { diagnosticOperation, diagnosticFailure } from './diagnostics.js';
import { DeclaredMethodology } from './declared-methodology.js';
import { DmrvnChain } from './dmrvn-chain.js';
import { DmrvnConfig } from './dmrvn-config.js';
import { normalizeAddress } from './dmrvn-crypto.js';
import { DmrvnError, type DmrvnErrorCode } from './errors.js';
import type { EvmRpc } from './evm-rpc.js';
import type { EvmSigner } from './evm-signer.js';
import type { GreenfieldIdentity } from './greenfield-storage.js';

export type PreflightCheck = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: DmrvnErrorCode };
export interface DmrvnPreflightResult {
  readonly deploymentId: string;
  readonly ready: boolean;
  readonly verifiedMetadata: Readonly<Record<string, unknown>> | null;
  readonly approver: string;
  readonly relay: string;
  readonly storageSigner: string;
  readonly checks: {
    readonly deployment: PreflightCheck;
    readonly approverRole: PreflightCheck;
    readonly methodology: PreflightCheck;
    readonly evidenceContract: PreflightCheck;
    readonly relayBalanceWei: PreflightCheck;
    readonly greenfieldWriteRead: 'NOT_TESTED';
    readonly validatorReadAccess: 'OPERATOR_CONFIRMATION_REQUIRED';
  };
}

/** 읽기 전용 준비 확인. ready는 저장소/검증자 접근이나 Evidence 버전의 외부 수용을 입증하지 않는다. */
export class DmrvnPreflight {
  #chain: DmrvnChain;
  #config: DmrvnConfig;
  #operator: EvmSigner;
  #storage: GreenfieldIdentity;
  #methodology: DeclaredMethodology;

  constructor(config: DmrvnConfig, rpc: EvmRpc, operator: EvmSigner, storage: GreenfieldIdentity, methodology: DeclaredMethodology) {
    this.#chain = new DmrvnChain(config, rpc);
    this.#config = config;
    this.#operator = operator;
    this.#storage = storage;
    this.#methodology = methodology;
    normalizeAddress(operator.address);
    normalizeAddress(storage.address);
    if (storage.chainId !== config.greenfieldChainId) throw new DmrvnError('WRONG_CHAIN');
    if (!(methodology instanceof DeclaredMethodology)) throw new TypeError('방법론이 필요합니다');
    methodology.validatePartner(config.partnerId);
  }

  async run(signal?: AbortSignal): Promise<DmrvnPreflightResult> {
    return diagnosticOperation('dmrvn-preflight.run', undefined, async () => {
      const check = async (fn: () => unknown | Promise<unknown>): Promise<PreflightCheck> => {
        try { return { ok: true, value: await fn() }; }
        catch (error) {
          diagnosticFailure(error);
          if (error instanceof DmrvnError) return { ok: false, code: error.code };
          throw error;
        }
      };
      const deployment = await check(async () => {
        this.#config.deployment.requireWritable();
        return this.#chain.verifyDeployment(undefined, signal);
      });
      const approverRole = await check(async () => { await this.#chain.verifyApprover(this.#operator.address, signal); return true; });
      const methodology = await check(async () => { await this.#methodology.verifyActive(); return true; });
      const evidenceContract = await check(() => { this.#methodology.requireExplicitEvidenceVersion(); return true; });
      const relayBalanceWei = await check(async () => String(DmrvnChain.number(await this.#chain.call('eth_getBalance',
        [normalizeAddress(this.#operator.address), 'latest'], signal))));
      const checks = {
        deployment, approverRole, methodology, evidenceContract, relayBalanceWei,
        greenfieldWriteRead: 'NOT_TESTED' as const, validatorReadAccess: 'OPERATOR_CONFIRMATION_REQUIRED' as const
      };
      return {
        deploymentId: this.#config.deploymentId(), ready: [deployment, approverRole, methodology, evidenceContract, relayBalanceWei].every(value => value.ok),
        verifiedMetadata: deployment.ok ? deployment.value as Readonly<Record<string, unknown>> : null,
        approver: normalizeAddress(this.#operator.address), relay: normalizeAddress(this.#operator.address),
        storageSigner: normalizeAddress(this.#storage.address), checks
      };
    }, 'preflight');
  }
}
