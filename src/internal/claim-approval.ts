import { hexString, normalizeAddress, recover, uint } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';

export function beneficiaryKey(context: OperationContext, address: string): string {
  return `claim-nonce:${context.config.deploymentId()}:${normalizeAddress(address)}`;
}

export async function validateCurrent(context: OperationContext, request: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  requireState(uint(request.deadline, 64) > await context.chain.timestamp(signal), 'REQUEST_EXPIRED');
  requireState(await context.chain.nonce(stateString(request.beneficiary), false, signal) === uint(request.nonce, 256), 'NONCE_CONFLICT');
}

export async function approvedState(context: OperationContext, key: string): Promise<Record<string, unknown>> {
  const state = await context.required(key);
  requireState(Object.hasOwn(state, 'approved'), 'OPERATION_NOT_PREPARED');
  return state;
}

export async function verifyBeforeSubmission(context: OperationContext, state: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const approved = stateMap(state.approved), request = stateMap(approved.claimRequest);
  const signer = recover(DmrvnProtocol.digest('ClaimRequest', DmrvnProtocol.domain(context.config.chainId, context.config.claimAddress), request),
    stateString(approved.approvalSignature));
  DmrvnProtocol.verifyProvenance(stateMap(state.evidence), stateString(request.evidenceHash), signer);
  await context.chain.verifyApprover(signer, signal);
  await validateCurrent(context, request, signal);
}

/** 저장소 실측 후 요청을 서명 전에 고정한다. 만료/nonce 충돌 시 새 요청으로 교체하지 않는다. */
export async function approveClaim(context: OperationContext, operationId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const key = operationKey(operationId);
  const { config, chain, operator, storage, methodology, journal } = context;
  return journal.withLock(key, async () => {
    const state = await context.required(key);
    requireState(Object.hasOwn(state, 'upload'), 'OPERATION_NOT_PREPARED');
    await context.verifyState(key, state, true, signal);
    if (Object.hasOwn(state, 'approved')) return copyState(state.approved);
    await chain.verifyApprover(operator.address, signal);
    DmrvnProtocol.verifyProvenance(stateMap(state.evidence), DmrvnJson.hash(state.evidence), operator.address);
    await methodology.verifyActive();
    const location = stateMap(state.evidenceLocation);
    requireState((await storage.head(copyState(location), signal)).sealed, 'OBJECT_UNSEALED');
    requireState(hexString(DmrvnJson.bytes(state.evidence)) === hexString(await storage.read(copyState(location), signal)), 'STORAGE_MISMATCH');
    const user = stateString(state.beneficiary);
    methodology.validate(stateMap(state.body), config.partnerId, user);
    const reservationKey = beneficiaryKey(context, user);
    return journal.withLock(reservationKey, async () => {
      await context.reserve(reservationKey, operationId);
      if (!Object.hasOwn(state, 'claimRequest')) {
        const nonce = (await chain.nonce(user, false, signal)).toString();
        const deadline = await chain.timestamp(signal) + 900n;
        if (deadline > 9223372036854775807n) throw new RangeError('승인 deadline이 int64 범위를 벗어났습니다');
        state.claimRequest = { claimId: state.claimId, beneficiary: user, partnerId: config.partnerId,
          activityId: methodology.activityId(), methodologyId: methodology.id(), methodologyVersion: methodology.version(),
          evidenceHash: DmrvnJson.hash(state.evidence), methodologyHash: methodology.hash(), evidenceLocation: copyState(location),
          nonce, deadline: deadline.toString() };
        await context.save(key, state);
      }
      const request = stateMap(state.claimRequest);
      await validateCurrent(context, request, signal);
      const domain = DmrvnProtocol.domain(config.chainId, config.claimAddress);
      const digest = DmrvnProtocol.digest('ClaimRequest', domain, request);
      const signature = await operator.signTypedData(DmrvnProtocol.typedData('ClaimRequest', domain, request), signal);
      requireState(recover(digest, signature) === normalizeAddress(operator.address), 'SIGNATURE_INVALID');
      const value = { claimRequest: request, approvalSignature: signature, approvalDigest: digest, deployment: state.deployment };
      state.approved = value; state.phase = 'APPROVED'; await context.save(key, state);
      return copyState(value);
    });
  });
}
