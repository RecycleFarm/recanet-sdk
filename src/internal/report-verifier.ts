import { DmrvnAbi } from '../dmrvn-abi.js';
import type { DmrvnConfig } from '../dmrvn-config.js';
import { bytes32, keccak, normalizeAddress, recover, uint, ZERO_BYTES32 } from '../dmrvn-crypto.js';
import { DmrvnJson } from '../dmrvn-json.js';
import { DmrvnProtocol } from '../dmrvn-protocol.js';
import { DmrvnError } from '../errors.js';
import { isJavaBlank } from '../member-identity.js';
import { requireState, stateMap, stateString } from './dmrvn-state.js';

const match = (value: boolean): void => requireState(value, 'REPORT_MISMATCH');
const same = (a: unknown, b: unknown): void => match(String(a ?? null) === String(b ?? null));
function list(value: unknown): unknown[] { requireState(Array.isArray(value), 'REPORT_MISMATCH'); return value; }
function equalAddresses(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }

/** 승인 배포의 성공 receipt를 확인한 reader 전용. 독립 역할/정책 조회를 수행하지 않는다. */
export function verifyReport(config: DmrvnConfig, claimId: string, stored: Record<string, unknown>, event: Record<string, unknown> | null,
  tx: Record<string, unknown>, bytes: Uint8Array, expectedFileHash: string | null): Record<string, unknown> {
  try { return verify(config, claimId, stored, stateMap(event), tx, bytes, expectedFileHash); }
  catch { throw new DmrvnError('REPORT_MISMATCH'); }
}

function verify(config: DmrvnConfig, claimId: string, stored: Record<string, unknown>, event: Record<string, unknown>,
  tx: Record<string, unknown>, bytes: Uint8Array, expectedFileHash: string | null): Record<string, unknown> {
  match(config.claimAddress.toLowerCase() === stateString(tx.to).toLowerCase());
  for (const key of ['status', 'outputHash', 'reportHash']) same(event[key], stored[key]);
  const call = DmrvnAbi.CLAIM.decodeCall('onReport', stateString(tx.input));
  const assignment = stateMap(call.assignment), observation = stateMap(call.observation), committee = list(call.committee).map(stateString);
  const domain = DmrvnProtocol.domain(config.chainId, config.claimAddress);
  same(assignment.claimId, claimId); same(observation.claimId, claimId); same(assignment.taskId, observation.taskId);
  same(event.taskId, assignment.taskId); same(event.committeeHash, assignment.committeeHash);
  const threshold = Number(uint(assignment.threshold, 8));
  same(assignment.committeeSize, committee.length);
  match(threshold > 0 && threshold <= committee.length);
  match(equalAddresses(DmrvnProtocol.sortedAddresses(committee), committee));
  same(DmrvnProtocol.committeeHash(assignment, committee), assignment.committeeHash);
  for (const key of ['committeeHash', 'quorumPolicyVersion', 'deadline']) same(assignment[key], observation[key]);
  for (const key of ['partnerId', 'activityId', 'methodologyId', 'methodologyVersion', 'evidenceHash', 'methodologyHash', 'evidenceLocationHash', 'outputHash']) {
    same(stored[key], observation[key]);
  }
  same(DmrvnProtocol.evidenceLocationHash(stateMap(stored.evidenceLocation)), stored.evidenceLocationHash);
  same(observation.result, stored.status);
  const coordinator = recover(DmrvnProtocol.digest('TaskAssignment', domain, assignment), stateString(call.coordinatorSignature));
  const digest = DmrvnProtocol.digest('MrvObservation', domain, observation);
  const signers = list(call.observationSignatures).map(signature => recover(digest, stateString(signature)));
  match(signers.length >= threshold && signers.length <= committee.length && new Set(signers).size === signers.length
    && signers.every(signer => committee.includes(signer)));
  same(DmrvnProtocol.reportHash(assignment, observation, signers, domain), stored.reportHash);
  const fileHash = keccak(bytes);
  if (expectedFileHash !== null) same(fileHash, bytes32(expectedFileHash));
  const report = stateMap(DmrvnJson.parse(bytes));
  for (const key of ['evidenceHash', 'methodologyHash', 'reportHash']) same(report[key], stored[key]);
  same(report.claimId, claimId); same(report.taskId, assignment.taskId); same(report.committeeHash, assignment.committeeHash);
  same(report.schemaVersion, 1); same(report.result, stored.status);
  const outputs = stateMap(report.outputs);
  if (String(stored.status) === '2') { same(DmrvnJson.hash(outputs), stored.outputHash); match(stored.outputHash !== ZERO_BYTES32); }
  else { match(Object.keys(outputs).length === 0); same(ZERO_BYTES32, stored.outputHash); }
  for (const raw of Object.values(outputs)) {
    const output = stateMap(raw), keys = Object.keys(output).sort();
    match(keys.length === 3 && keys[0] === 'scale' && keys[1] === 'unit' && keys[2] === 'value');
    match(/^-?(0|[1-9][0-9]*)$/.test(stateString(output.value)) && !isJavaBlank(stateString(output.unit)));
    uint(output.scale, 32);
  }
  const source = stateMap(report.source);
  same(normalizeAddress(stateString(source.approver)), normalizeAddress(stateString(stored.approver)));
  same(DmrvnProtocol.evidenceLocationHash(stateMap(source.evidenceLocation)), stored.evidenceLocationHash);
  same(source.evidenceLocationHash, stored.evidenceLocationHash);
  const entries = list(report.observations);
  match(entries.length === signers.length);
  const reportSigners = entries.map(raw => {
    const entry = stateMap(raw), entryDigest = DmrvnProtocol.digest('MrvObservation', domain, stateMap(entry.observation));
    same(entryDigest, digest);
    const signer = recover(entryDigest, stateString(entry.signature));
    same(signer, normalizeAddress(stateString(entry.signer))); return signer;
  });
  match(equalAddresses(DmrvnProtocol.sortedAddresses(reportSigners), DmrvnProtocol.sortedAddresses(signers)));
  return { reportVerified: true, reportHash: stored.reportHash, outputHash: stored.outputHash, fileHash,
    fileHashVerification: expectedFileHash === null ? 'DOWNLOAD_CHECKSUM_ONLY' : 'MATCHED_EXTERNAL_COMMITMENT',
    metadataIndependentlyVerified: false, authorizationEvidence: 'SUCCESSFUL_V7_RECEIPT', coordinator, signers, outputs, report };
}
