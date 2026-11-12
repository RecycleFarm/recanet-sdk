import { DmrvnError, PrivyApiError, PrivyAuthenticationError, TransactionQueryError } from './errors.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type SubmissionState = 'NOT_ATTEMPTED' | 'OUTCOME_UNKNOWN' | 'ACCEPTED' | 'CONFIRMED' | 'NOT_BROADCAST' | 'REJECTED';
export type DiagnosticRecord = Readonly<Record<string, string | number | boolean>>;
/** Structural subset of the OpenTelemetry Logs API; inject a provider, never a global. */
export interface DiagnosticLoggerProvider {
  getLogger(name: string, version?: string): {
    emit(record: {
      timestamp: Date; severityNumber: number; severityText: string; body: string;
      attributes: Record<string, string | number | boolean>;
    }): void
  };
}
export interface DiagnosticOptions {
  readonly enabled?: boolean;
  readonly localLogging?: boolean;
  readonly detailedLogging?: boolean;
  readonly partnerId?: string | number;
  readonly environment?: string;
  readonly loggerProvider?: DiagnosticLoggerProvider;
  readonly localSink?: (json: string) => void;
}
interface Submission { target: string; state: SubmissionState; sequence: number; identity?: string }
interface Root {
  id: string; operation: string; options: DiagnosticOptions; sequence: number;
  checkpoints: Set<string>; partnerId?: string | undefined;
}
interface Frame {
  root: Root; stage: string; parent?: Frame | undefined; logOwner?: Frame; callId?: string | undefined; started: number;
  lastStage?: string | undefined; lastState?: string | undefined; submission?: Submission | undefined; activeSubmission?: Submission | undefined;
  pendingSubmission?: { target: string; operationId: string | undefined } | undefined;
  // Only identities propagating through this call are retained. No process-wide error cache.
  failures: Set<unknown>; handledResults: Set<unknown>; requests: Map<number, Submission>; httpStatus?: number; upstreamCode?: string;
}
const context = new AsyncLocalStorage<Frame>();
const managedAdapters = new WeakSet<object>();
let defaults: DiagnosticOptions = Object.freeze({});
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const attempt = (fn: () => unknown): void => {
  try {
    const result = fn();
    if (result && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
  } catch { /* diagnostics must not alter business behavior */ }
};

/** Configure only this SDK. Provider flush/shutdown and bounded batch export belong to the host. */
export function configureDiagnostics(options: DiagnosticOptions = {}): void { defaults = Object.freeze({ ...options }); }

/** Messages are untrusted: unsafe formats fall back to a fixed explanation. Never serialize errors. */
export function sanitizeDiagnosticMessage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || /[{}\[\]]/.test(value)) return 'SDK operation failed';
  return value
    .replace(/-----BEGIN[\s\S]*?(?:-----END[^-]*-----|$)/gi, '[REDACTED]')
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED]')
    .replace(/\b(?:[\w.-]*(?:token|secret|password|private[_ -]?key|signature|authorization)[\w.-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, '[REDACTED]')
    .replace(/(?:0x)?[A-Fa-f0-9]{32,}|[A-Za-z0-9_+/=-]{32,}/g, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 512);
}
function safeLabel(value: unknown): string | undefined {
  return (typeof value === 'number' && Number.isFinite(value)) ? String(value)
    : typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}
// Error codes are not operation IDs. Never copy opaque values from an upstream error.
function safeDiagnosticCode(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  if (typeof value !== 'string') return undefined;
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(value)) return undefined;
  if (/^-?\d{1,10}$/.test(value)) return value;
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value) && sanitizeDiagnosticMessage(value) === value
    ? value : undefined;
}
function emit(frame: Frame, event: string, detail = false, fields: Record<string, string | number | boolean> = {}): void {
  attempt(() => {
    const { root } = frame, o = root.options;
    if (o.enabled === false) return;
    const record: Record<string, string | number | boolean> = {
      event, operation_id: root.id, operation: root.operation, sdk_version: '0.1.0',
    };
    const partner = safeLabel(root.partnerId ?? o.partnerId), environment = safeLabel(o.environment);
    if (partner !== undefined) record.partner_id = partner;
    if (environment !== undefined) record.environment = environment;
    if (detail) {
      record.last_confirmed_stage = frame.lastStage ?? 'NONE';
      record.last_confirmed_state = frame.lastState ?? 'NONE';
      record.submission_state = frame.submission?.state ?? 'NOT_ATTEMPTED';
      if (frame.submission) {
        record.submission_target = frame.submission.target;
        record.submission_sequence = frame.submission.sequence;
      }
    }
    if (o.detailedLogging) {
      const owner = frame.logOwner ?? frame;
      record.stage = owner.stage;
      record.call_id = owner.callId!;
      if (owner.parent?.callId) record.parent_call_id = owner.parent.callId;
      record.duration_ms = Math.max(0, performance.now() - owner.started);
    }
    Object.assign(record, fields);
    const snapshot = Object.freeze(record), now = new Date();
    if (o.localLogging !== false) attempt(() => (o.localSink ?? console.log)(JSON.stringify(snapshot)));
    if (o.loggerProvider) attempt(() => o.loggerProvider!.getLogger('recanet', '0.1.0').emit({
      timestamp: now, severityNumber: event === 'failed' ? 17 : 9,
      severityText: event === 'failed' ? 'ERROR' : 'INFO', body: event, attributes: { ...snapshot },
    }));
  });
}
function propagate(frame: Frame, update: (f: Frame) => void): void {
  for (let f: Frame | undefined = frame; f; f = f.parent) update(f);
}
function failure(frame: Frame, error: unknown): void {
  attempt(() => {
    if (frame.failures.has(error)) return;
    // Propagation cache is bounded per call. Saturation emits extra errors rather than losing them.
    propagate(frame, f => { if (f.failures.size < 128) f.failures.add(error); });
    const fields: Record<string, string | number | boolean> = {
      failed_stage: frame.stage, 'error.type': 'Error',
      'error.message': 'SDK operation failed'
    };
    attempt(() => {
      if (error instanceof Error) {
        fields['error.type'] = ['DmrvnError', 'PrivyApiError', 'PrivyAuthenticationError', 'TransactionQueryError', 'TypeError', 'RangeError', 'Error', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'Error';
        fields['error.message'] = error instanceof DmrvnError || error instanceof PrivyApiError || error instanceof PrivyAuthenticationError || error instanceof TransactionQueryError
          ? sanitizeDiagnosticMessage(error.message) : 'SDK operation failed';
        const e = error as Error & { code?: unknown; statusCode?: unknown; definitelyNotBroadcast?: boolean; definitelyRejected?: boolean };
        const code = safeDiagnosticCode(e.code); if (code) fields['error.code'] = code;
        if (typeof e.statusCode === 'number' && e.statusCode > 0) fields['http.status_code'] = e.statusCode;
        if (frame.submission && e.definitelyNotBroadcast) frame.submission.state = 'NOT_BROADCAST';
        if (frame.submission && e.definitelyRejected) frame.submission.state = 'REJECTED';
      }
    });
    const reasons: Record<string, string> = {
      UNAUTHORIZED_SIGNER: 'Signer or partner authorization failed', FORBIDDEN: 'Upstream denied authorization',
      INVALID_CREDENTIALS: 'Upstream rejected application credentials', INVALID_INPUT: 'Input validation failed',
      RPC_UNAVAILABLE: 'RPC transport or response validation failed', UNAVAILABLE: 'Upstream transport failed',
      INTERRUPTED: 'Operation was interrupted', SUBMISSION_UNRESOLVED: 'Submission outcome could not be confirmed',
      STORAGE_CREATE_UNRESOLVED: 'Object creation outcome could not be confirmed',
    };
    const reason = reasons[String(fields['error.code'])];
    if (reason && reason !== fields['error.message']) fields['error.reason'] = reason;
    if (frame.httpStatus !== undefined) fields['http.status_code'] = frame.httpStatus;
    if (frame.upstreamCode !== undefined) fields['upstream.code'] = frame.upstreamCode;
    emit(frame, 'failed', true, fields);
  });
}
function observeResult(frame: Frame, value: unknown, resultPolicy: 'default' | 'preflight'): void {
  attempt(() => {
    if (!value || typeof value !== 'object') return;
    const result = value as Record<string, unknown>;
    if (frame.handledResults.has(value)) return;
    const status = result.status && typeof result.status === 'object' ? (result.status as Record<string, unknown>).state : result.state;
    if (typeof status === 'string' && ['NOT_FOUND', 'PENDING', 'MINED', 'SUCCEEDED', 'REVERTED'].includes(status)) diagnosticState(status);
    if (result.outcome === 'FAILED' || result.outcome === 'UNKNOWN' || result.ok === false || (resultPolicy === 'preflight' && result.ready === false) || result.reportError !== undefined || result.errorCode !== undefined) {
      propagate(frame, f => { if (f.handledResults.size < 128) f.handledResults.add(value); });
      if (frame.failures.size === 0) failure(frame, Object.assign(new Error('SDK returned a failure result'), { code: result.errorCode }));
      emit(frame, 'failure_handled', true);
    }
  });
}
/** Common sync/async operation boundary. Business callbacks execute exactly once. */
export function diagnosticOperation<T>(stage: string, id: unknown, action: () => T, resultPolicy: 'default' | 'preflight' = 'default'): T {
  const parent = context.getStore();
  const root: Root = parent?.root ?? {
    id: validId(id) ? id : randomUUID(), operation: stage,
    options: defaults, sequence: 0, checkpoints: new Set()
  };
  const frame: Frame = {
    root, stage, parent, started: root.options.detailedLogging ? performance.now() : 0,
    callId: root.options.detailedLogging ? randomUUID() : undefined, failures: new Set(), handledResults: new Set(), requests: new Map(parent?.requests),
    lastStage: parent?.lastStage, lastState: parent?.lastState,
    submission: parent?.submission, activeSubmission: parent?.activeSubmission, pendingSubmission: parent?.pendingSubmission
  };
  return context.run(frame, () => {
    if (root.options.detailedLogging) emit(frame, 'started');
    const done = (value: unknown) => {
      observeResult(frame, value, resultPolicy);
      propagate(frame, f => { f.lastStage = stage; });
      if (!parent || root.options.detailedLogging) emit(frame, 'completed');
    };
    try {
      const value = action();
      if (value instanceof Promise) return value.then(result => { done(result); return result; }, error => {
        failure(frame, error); throw error;
      }) as T;
      done(value); return value;
    } catch (error) { failure(frame, error); throw error; }
  });
}
/** Explicit outer context for APIs without operationId parameters. Does not change business keys. */
export function withDiagnosticOperation<T>(operation: string, operationId: string | undefined, action: () => T): T {
  return diagnosticOperation(operation, operationId, action);
}
/** Bind work scheduled through a host executor/callback boundary. */
export function bindDiagnosticContext<T extends (...args: any[]) => any>(action: T): T {
  const frame = context.getStore();
  return ((...args: Parameters<T>) => context.run(frame!, () => action(...args))) as T;
}
export function diagnosticState(state: unknown, checkpoint = false): void {
  attempt(() => {
    const frame = context.getStore(), label = safeLabel(state); if (!frame || !label) return;
    propagate(frame, f => { f.lastState = label; });
    if (checkpoint && !frame.root.checkpoints.has(label)) {
      if (frame.root.checkpoints.size < 64) frame.root.checkpoints.add(label);
      emit(frame, 'checkpoint', true, { checkpoint: label });
    } else if (frame.root.options.detailedLogging) emit(frame, 'state', true);
  });
}
/** Use only at an actual side-effect boundary, after validation/preparation. */
export function diagnosticSubmission<T>(target: string, action: () => T, accepted: (value: Awaited<T>) => boolean, operationId?: string, adapter?: object): T {
  const frame = context.getStore(); if (!frame || frame.activeSubmission) return action();
  if (adapter && managedAdapters.has(adapter)) {
    // Built-in adapters perform checks before their own submission boundary.
    const child: Frame = { ...frame, parent: frame, logOwner: frame.logOwner ?? frame,
      pendingSubmission: frame.pendingSubmission ?? { target, operationId } };
    return context.run(child, action);
  }
  target = frame.pendingSubmission?.target ?? target;
  operationId = frame.pendingSubmission?.operationId ?? operationId;
  const submission: Submission = {
    target, state: 'OUTCOME_UNKNOWN', sequence: ++frame.root.sequence,
    ...(operationId === undefined ? {} : { identity: operationId + ':' + target })
  };
  propagate(frame, f => { f.submission = submission; f.requests.set(submission.sequence, submission); });
  // The synthetic context carries submission state, but is not a new logical call.
  const child: Frame = { ...frame, parent: frame, logOwner: frame.logOwner ?? frame, activeSubmission: submission, submission };
  return context.run(child, () => {
    emit(child, 'submission_started', true);
    const done = (value: Awaited<T>) => {
      attempt(() => {
        if (accepted(value) && submission.state !== 'ACCEPTED' && submission.state !== 'CONFIRMED') {
          submission.state = 'ACCEPTED'; emit(child, 'submission_accepted', true);
        }
      });
      return value;
    };
    try {
      const value = action();
      return value instanceof Promise ? value.then(done, error => { failure(child, error); throw error; }) as T : done(value as Awaited<T>) as T;
    } catch (error) { failure(child, error); throw error; }
  });
}
/** Internal marker: this adapter owns a submission boundary after its pre-send checks. */
export function diagnosticManagedAdapter<T extends object>(adapter: T): T {
  managedAdapters.add(adapter); return adapter;
}
export function diagnosticAccepted(target?: string, operationId?: string): void {
  attempt(() => {
    const frame = context.getStore(); if (!frame) return;
    const submission = target === undefined ? frame.submission
      : [...frame.requests.values()].reverse().find(request => request.target === target && (operationId === undefined || request.identity === operationId + ':' + target));
    if (!submission || submission.state === 'ACCEPTED' || submission.state === 'CONFIRMED') return;
    submission.state = 'ACCEPTED'; emit({ ...frame, submission }, 'submission_accepted', true);
  });
}
export function diagnosticConfirmed(target?: string, operationId?: string): void {
  attempt(() => {
    const frame = context.getStore(); if (!frame) return;
    const submission = target === undefined ? frame.submission
      : [...frame.requests.values()].reverse().find(request => request.target === target && (operationId === undefined || request.identity === operationId + ':' + target));
    if (!submission || submission.state === 'CONFIRMED') return;
    if (submission.state === 'OUTCOME_UNKNOWN') diagnosticAccepted(target, operationId);
    submission.state = 'CONFIRMED'; emit({ ...frame, submission }, 'submission_confirmed', true);
  });
}

/** Preserve identity when an SDK boundary translates an already logged failure. */
export function diagnosticTranslated<T>(original: unknown, translated: T): T {
  attempt(() => {
    const frame = context.getStore();
    if (frame?.failures.has(original)) propagate(frame, f => { if (f.failures.size < 128) f.failures.add(translated); });
  });
  return translated;
}
export function diagnosticFailure(error: unknown): void {
  const frame = context.getStore(); if (frame) failure(frame, error);
}

/** Restore observed journal facts without re-emitting state transitions. */
export function diagnosticRestore(state: Record<string, unknown>): void {
  attempt(() => {
    const frame = context.getStore(); if (!frame) return;
    diagnosticState(state.phase);
    if (state.upload) frame.root.checkpoints.add('EVIDENCE_SEALED');
    if (state.approved) frame.root.checkpoints.add('APPROVED');
    let restored: Submission | undefined;
    if (state.txHash || state.submitFromBlock !== undefined) restored = {
      target: 'evm.sendTransaction',
      sequence: 0, state: state.submissionStatus === 'CONFIRMED' ? 'CONFIRMED' : state.txHash ? 'ACCEPTED' : 'OUTCOME_UNKNOWN'
    };
    else if (state.createTxHash || state.createIntent) restored = {
      target: 'greenfield.create',
      sequence: 0, state: state.upload ? 'CONFIRMED' : state.createTxHash ? 'ACCEPTED' : 'OUTCOME_UNKNOWN'
    };
    if (restored) {
      const identity = String(state.operationId) + ':' + restored.target;
      const existing = [...frame.requests.values()].reverse().find(request => request.identity === identity);
      if (existing) {
        // A stale journal cannot undo evidence already observed for this request.
        if (existing.state === 'NOT_ATTEMPTED' || existing.state === 'OUTCOME_UNKNOWN'
          || (existing.state === 'ACCEPTED' && restored.state === 'CONFIRMED')) existing.state = restored.state;
        restored = existing;
      }
      if (!existing) restored.sequence = ++frame.root.sequence;
      restored.identity = identity;
      const request = restored;
      propagate(frame, f => { f.submission = request; f.requests.set(request.sequence, request); });
    }
  });
}

export function diagnosticPartner(value: unknown): void {
  attempt(() => { const frame = context.getStore(), partner = safeLabel(value); if (frame && partner) frame.root.partnerId = partner; });
}

export function diagnosticUpstream(status?: number, code?: unknown): void {
  attempt(() => {
    const frame = context.getStore(); if (!frame) return;
    if (Number.isInteger(status) && status! >= 100 && status! <= 599) frame.httpStatus = status!;
    const safeCode = safeDiagnosticCode(code); if (safeCode) frame.upstreamCode = safeCode;
  });
}
