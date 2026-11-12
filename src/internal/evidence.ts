import { diagnosticOperation, diagnosticSubmission, diagnosticRestore, diagnosticConfirmed, diagnosticAccepted } from '../diagnostics.js';
import { bytes32, hexString, messageDigest, normalizeAddress, recover } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnError } from '../errors.js';
import { isJavaBlank } from '../member-identity.js';
import { copyState, operationKey, OperationContext, requireState, stateMap, stateString } from './dmrvn-state.js';

/** 모든 외부 부작용은 operation 잠금 안에서 원래 intent/바이트로 실행한다. */
export async function prepareEvidence(context: OperationContext, operationId: string, claimId: string, beneficiary: string,
  objectName: string, evidenceBody: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return diagnosticOperation('evidence.prepareEvidence', operationId, async () => {
    const key = operationKey(operationId), id = bytes32(claimId), user = normalizeAddress(beneficiary);
    const { config, methodology, operator, storage, journal, chain } = context;
    config.checkObject(objectName);
    const body = copyState(evidenceBody);
    methodology.validate(body, config.partnerId, user);
    const fingerprint = DmrvnJson.hash({
      body, claimId: id, beneficiary: user, objectName, deploymentId: config.deploymentId(),
      forwarder: config.forwarderAddress, methodologyHash: methodology.hash(), greenfieldChainId: config.greenfieldChainId,
      bucket: config.bucketName, prefix: config.objectPrefix, relay: normalizeAddress(operator.address), approver: normalizeAddress(operator.address),
      storageSigner: normalizeAddress(storage.address)
    });
    return journal.withLock(key, async () => {
      let state = await journal.load(key);
      if (state !== null) {
        diagnosticRestore(state);
        requireState(state.deploymentId === config.deploymentId(), 'DEPLOYMENT_COLLISION');
        requireState(state.fingerprint === fingerprint, 'OPERATION_INPUT_CHANGED');
      }
      let firstDeployment: Record<string, unknown> | null = null;
      if (state === null) { config.deployment.requireWritable(); firstDeployment = await chain.verifyDeployment(undefined, signal); }
      await context.reserveClaim(id, operationId);
      if (state === null) {
        state = {
          operationId, deploymentId: config.deploymentId(), deployment: firstDeployment, fingerprint,
          configurationFingerprint: context.configurationFingerprint(), body, claimId: id, beneficiary: user, phase: 'PREPARING'
        };
        await context.save(key, state);
      }
      const sourceKey = `source:${config.deploymentId()}:${config.partnerId}:${methodology.activityId()}:${body.sourceEventId}`;
      await journal.withLock(sourceKey, () => context.reserve(sourceKey, operationId));
      await context.verifyState(key, state, !Object.hasOwn(state, 'upload'), signal);
      if (Object.hasOwn(state, 'upload')) return copyState(state);
      await chain.verifyApprover(operator.address, signal);
      await methodology.verifyActive();
      if (!Object.hasOwn(state, 'evidence')) {
        const message = 'DMRVN v4 source:' + DmrvnJson.hash(body);
        const signature = await operator.signMessage(message, signal);
        requireState(recover(messageDigest(message), signature) === normalizeAddress(operator.address), 'SIGNATURE_INVALID');
        const evidence = copyState(body);
        evidence.provenance = { signer: operator.address, sourceSignature: signature };
        requireState(DmrvnJson.bytes(evidence).length <= 1048576, 'INVALID_INPUT');
        state.evidence = evidence; state.phase = 'EVIDENCE_SIGNED'; await context.save(key, state);
      }
      const bytes = DmrvnJson.bytes(state.evidence);
      const location = { storageType: 1, chainId: config.greenfieldChainId, bucketName: config.bucketName, objectName };
      state.evidenceLocation = location; await context.save(key, state);
      let head = await storage.head(copyState(location), signal);
      if (!head.exists) {
        requireState(!Object.hasOwn(state, 'createIntent'), 'STORAGE_CREATE_UNRESOLVED');
        state.createIntent = true; await context.save(key, state);
        let hash: string;
        try { hash = await diagnosticSubmission('greenfield.create', () => storage.create(copyState(location), Uint8Array.from(bytes), signal), hash => typeof hash === 'string' && hash.trim().length > 0, operationId, storage); }
        catch (error) {
          if (error instanceof DmrvnError && (error.definitelyNotBroadcast || error.definitelyRejected)) {
            delete state.createIntent; state.lastStorageError = error.code; await context.save(key, state);
          }
          throw error;
        }
        requireState(typeof hash === 'string' && !isJavaBlank(hash), 'STORAGE_CREATE_UNRESOLVED');
        state.createTxHash = hash; state.phase = 'EVIDENCE_CREATE_BROADCAST'; await context.save(key, state);
        head = await storage.head(copyState(location), signal);
      }
      if (head.exists) { state.objectExists = true; await context.save(key, state); }
      if (!head.sealed) {
        requireState(typeof state.createTxHash === 'string', 'STORAGE_CREATE_UNRESOLVED');
        await diagnosticSubmission('greenfield.upload', () => storage.upload(copyState(location), Uint8Array.from(bytes), state!.createTxHash as string, signal), () => true, operationId, storage);
      }
      requireState((await storage.head(copyState(location), signal)).sealed, 'OBJECT_UNSEALED');
      const stored = await storage.read(copyState(location), signal);
      requireState(hexString(bytes) === hexString(stored), 'STORAGE_MISMATCH');
      state.upload = {
        evidenceHash: DmrvnJson.hash(state.evidence), evidenceLocation: location,
        createTxHash: state.createTxHash ?? null, status: 'SEALED'
      };
      diagnosticConfirmed('greenfield.create', operationId); diagnosticConfirmed('greenfield.upload', operationId);
      state.phase = 'EVIDENCE_SEALED'; delete state.lastStorageError; await context.save(key, state);
      return copyState(state);
    });
  });
}

export async function recoverCreateTransaction(context: OperationContext, operationId: string, createTxHash: string,
  signal?: AbortSignal): Promise<void> {
  return diagnosticOperation('evidence.recoverCreateTransaction', operationId, async () => {
    const key = operationKey(operationId);
    await context.journal.withLock(key, async () => {
      const state = await context.required(key);
      requireState(Object.hasOwn(state, 'createIntent') && Object.hasOwn(state, 'evidenceLocation'), 'OPERATION_NOT_PREPARED');
      requireState(await context.storage.matchesCreateTransaction(copyState(stateMap(state.evidenceLocation)), createTxHash, signal), 'STORAGE_MISMATCH');
      if (Object.hasOwn(state, 'createTxHash')) requireState(createTxHash === stateString(state.createTxHash), 'OPERATION_INPUT_CHANGED');
      diagnosticAccepted('greenfield.create', operationId);
      state.createTxHash = createTxHash;
      await context.save(key, state);
    });
  });
}
