import { diagnosticOperation, diagnosticFailure, diagnosticTranslated } from './diagnostics.js';
import { DmrvnChain } from './dmrvn-chain.js';
import type { DmrvnConfig } from './dmrvn-config.js';
import { bytes32, uint } from './dmrvn-crypto.js';
import { DmrvnJson } from './dmrvn-json.js';
import { DmrvnProtocol } from './dmrvn-protocol.js';
import { DmrvnError } from './errors.js';
import type { EvmRpc } from './evm-rpc.js';
import type { ReportReader } from './greenfield-public-reader.js';
import { chainNumber } from './internal/chain-id.js';
import { copyState, requireState, stateMap, stateString } from './internal/dmrvn-state.js';
import { verifyReport } from './internal/report-verifier.js';

export interface ReportResolver {
  resolve(reportHash: string, signal?: AbortSignal): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** Privy 자격 증명 없이 승인 배포·Claim·보고 거래·원시 파일을 읽고 대조한다. 전송/대기는 하지 않는다. */
export class DmrvnReader {
  #config: DmrvnConfig;
  #chain: DmrvnChain;
  #reader: ReportReader;
  #resolver: ReportResolver;
  constructor(config: DmrvnConfig, rpc: EvmRpc, reader: ReportReader, resolver: ReportResolver) {
    this.#config = config; this.#chain = new DmrvnChain(config, rpc);
    if (!reader || typeof reader.read !== 'function' || !resolver || typeof resolver.resolve !== 'function') throw new TypeError('보고서 reader와 resolver가 필요합니다');
    this.#reader = reader; this.#resolver = resolver;
  }
  static defaultReportResolver(chainId: string, bucket: string): ReportResolver {
    return {
      resolve: hash => ({
        storageType: 1, chainId, bucketName: bucket,
        objectName: 'dmrvn/v4/reports/' + bytes32(hash).slice(2) + '.json'
      })
    };
  }
  async readResult(claimId: string, fromBlock?: bigint | number | null, reportTxHash?: string | null, waitTimedOut = false,
    expectedFileHash?: string | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return diagnosticOperation('dmrvn-reader.readResult', undefined, async () => {
      const id = bytes32(claimId), head = await this.#chain.confirmedHead(signal);
      const verified = await this.#chain.verifyDeployment(head, signal), claim = await this.#chain.claim(id, head, signal);
      const status = Number(uint(claim.status, 8));
      requireState(status <= 4, 'RPC_UNAVAILABLE');
      const result: Record<string, unknown> = {
        claimId: id, chainId: this.#config.chainId, claimAddress: this.#config.claimAddress,
        deploymentId: this.#config.deploymentId(), verifiedMetadata: verified, observedBlock: head,
        chainStatus: ['NONE', 'PENDING', 'VALID', 'INVALID', 'REVOKED'][status], taskStatus: 'UNKNOWN', claim, reportVerified: false,
        observationStatus: status === 1 ? (waitTimedOut ? 'LOCAL_WAIT_TIMEOUT' : 'WAITING') : 'NOT_FINALIZED'
      };
      if (status !== 2 && status !== 3) return result;
      result.observationStatus = 'FINALIZED';
      try {
        let hash = reportTxHash ?? null;
        if (hash === null) {
          requireState(fromBlock != null, 'REPORT_LOOKUP_RANGE');
          hash = await this.#chain.findTransaction('MrvClaimReported', id, chainNumber(fromBlock), head, 'reportHash', stateString(claim.reportHash), signal);
        }
        requireState(hash !== null, 'REPORT_TX_NOT_FOUND');
        bytes32(hash);
        const receipt = await this.#chain.receipt(hash, head, signal), raw = await this.#chain.call('eth_getTransactionByHash', [hash], signal);
        requireState(receipt !== null && raw !== null, 'REPORT_TX_NOT_FOUND');
        requireState(DmrvnChain.number(receipt.status) === 1n, 'REPORT_MISMATCH');
        const tx = stateMap(raw);
        requireState(hash.toLowerCase() === stateString(tx.hash).toLowerCase() && tx.blockHash === receipt.blockHash, 'REPORT_MISMATCH');
        const event = this.#chain.event('MrvClaimReported', receipt, id);
        const pointer = await this.#resolver.resolve(stateString(claim.reportHash), signal);
        let bytes: Uint8Array;
        try {
          bytes = await this.#reader.read(copyState(pointer), signal);
          requireState(bytes instanceof Uint8Array && bytes.length <= 4 * 1024 * 1024, 'REPORT_READ_FAILED');
        } catch (error) { throw diagnosticTranslated(error, new DmrvnError('REPORT_READ_FAILED')); }
        Object.assign(result, verifyReport(this.#config, id, claim, event, tx, bytes, expectedFileHash ?? null));
        result.reportTxHash = hash; result.reportPointer = pointer; result.receipt = receipt;
      } catch (error) {
        diagnosticFailure(error);
        const code = error instanceof DmrvnError ? error.code : 'REPORT_MISMATCH';
        result.reportError = { code, retryable: error instanceof DmrvnError ? error.retryable() : false, action: 'READ_ONLY' };
      }
      return result;
    });
  }
  async verifyEvidenceProvenance(claimId: string, evidenceBytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    return diagnosticOperation('dmrvn-reader.verifyEvidenceProvenance', undefined, async () => {
      const head = await this.#chain.confirmedHead(signal);
      await this.#chain.verifyDeployment(head, signal);
      const claim = await this.#chain.claim(bytes32(claimId), head, signal);
      requireState(String(claim.status) !== '0', 'OPERATION_NOT_PREPARED');
      requireState(evidenceBytes instanceof Uint8Array && evidenceBytes.length <= 1048576, 'INVALID_INPUT');
      return DmrvnProtocol.verifyProvenance(stateMap(DmrvnJson.parse(evidenceBytes)), stateString(claim.evidenceHash), stateString(claim.approver));
    });
  }
}
