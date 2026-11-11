package com.youngminkim.recanet.telemetry;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.youngminkim.recanet.*;
import com.youngminkim.recanet.dmrvn.*;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.logs.Severity;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.ContextKey;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;

/** Structured operation logs only. Never creates spans or configures global exporters. */
public final class SdkTelemetry {
    public static final String LOGGER_NAME = "com.youngminkim.recanet.telemetry";
    private static final Logger LOCAL = Logger.getLogger(LOGGER_NAME);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ContextKey<Invocation> CURRENT = ContextKey.named("recanet-invocation");
    private static final SdkTelemetry LOCAL_ONLY = builder().build();
    private static final SdkTelemetry DISABLED = builder().localLogging(false).build();
    private final io.opentelemetry.api.logs.Logger logger;
    private final boolean localLogging;
    private final String partnerId, environment, version;

    /** Confirmed observations, not promises of durability or blockchain finality. */
    public enum State {
        NOT_STARTED, STEP_COMPLETED, CHAIN_VERIFIED, BALANCE_READ,
        WALLET_LOOKUP_COMPLETED, WALLET_NOT_FOUND, WALLET_FOUND, WALLET_CREATED,
        SIGNATURE_CREATED, PREPARING, EVIDENCE_SIGNED, EVIDENCE_CREATE_BROADCAST,
        EVIDENCE_SEALED, APPROVED, BROADCAST_INTENT, SUBMITTED, SUBMISSION_CONFIRMED,
        REPORT_READ, REPORT_VERIFIED
    }

    private SdkTelemetry(Builder builder) {
        localLogging = builder.localLogging;
        partnerId = builder.partnerId;
        environment = builder.environment;
        String packaged = SdkTelemetry.class.getPackage().getImplementationVersion();
        version = packaged == null ? "development" : packaged;
        logger = builder.openTelemetry == null ? null : builder.openTelemetry.getLogsBridge()
                .loggerBuilder(LOGGER_NAME).setInstrumentationVersion(version).build();
    }
    public static Builder builder() { return new Builder(); }
    public static SdkTelemetry local() { return LOCAL_ONLY; }
    public static SdkTelemetry disabled() { return DISABLED; }

    /** Invalid/missing IDs get a generated correlation ID without changing business validation. */
    public <T> T observe(String operation, String operationId, Supplier<T> action) {
        return execute(operation, operationId, action, false);
    }
    /** Logs an internal boundary in the same operation; no trace/span is created. */
    public <T> T step(String operation, Supplier<T> action) { return execute(operation, null, action, true); }
    /** Compatibility alias: now emits stage logs, never spans. */
    @Deprecated public <T> T traceStep(String operation, Supplier<T> action) { return step(operation, action); }

    private <T> T execute(String operation, String operationId, Supplier<T> action, boolean step) {
        Objects.requireNonNull(action, "action");
        if (!enabled()) return action.get();
        Invocation invocation;
        io.opentelemetry.context.Scope scope;
        boolean duplicate;
        try {
            var parent = Context.current();
            var previous = parent.get(CURRENT);
            String name = identifier(operation);
            duplicate = step && previous != null && Objects.equals(name, previous.operation);
            if (duplicate) { invocation = null; scope = null; }
            else {
                String id = UUID.randomUUID().toString();
                String suppliedId = identifier(operationId);
                String workId = previous != null ? previous.operationId : suppliedId != null ? suppliedId : id;
                Workflow workflow = previous != null && workId.equals(previous.operationId)
                        ? previous.workflow : new Workflow();
                invocation = new Invocation(id, previous == null ? id : previous.rootId,
                        previous == null ? null : previous.id, name == null ? "unknown" : name, workId, workflow);
                scope = parent.with(CURRENT, invocation).makeCurrent();
            }
        } catch (RuntimeException ignored) { return action.get(); }
        // The business action is outside setup's catch: never invoke it twice on failure.
        if (duplicate) return action.get();
        try {
            emit(invocation, "started", null, false);
            try {
                T result = action.get();
                if (invocation.handled == null && result instanceof Map<?, ?> map && map.containsKey("reportError"))
                    invocation.handled = invocation.workflow.handled();
                if (invocation.handled != null) emit(invocation, "failed", invocation.handled, true);
                else {
                    invocation.workflow.completed(invocation.operation);
                    emit(invocation, "completed", null, false);
                }
                return result;
            } catch (RuntimeException | Error failure) {
                emit(invocation, "failed", failure, false);
                throw failure;
            }
        } finally {
            try { scope.close(); } catch (RuntimeException ignored) { }
        }
    }
    public void observeVoid(String operation, String operationId, Runnable action) {
        observe(operation, operationId, () -> { action.run(); return null; });
    }
    public EvmRpc instrumentRpc(EvmRpc rpc) { return enabled() ? LoggedBoundaries.rpc(this, rpc) : rpc; }
    public EvmSigner instrumentSigner(EvmSigner signer) { return enabled() ? LoggedBoundaries.signer(this, signer) : signer; }
    public GreenfieldStorage instrumentStorage(GreenfieldStorage storage) {
        return enabled() ? LoggedBoundaries.storage(this, storage) : storage;
    }
    public void checkpoint(State state) {
        try {
            var invocation = Context.current().get(CURRENT);
            if (enabled() && invocation != null && invocation.workflow.checkpoint(invocation.operation, state))
                emit(invocation, "checkpoint", null, false);
        } catch (RuntimeException ignored) { }
    }
    /** Before a side effect; remains unknown unless acceptance/rejection is verified. */
    public void submissionAttempt() { submission("OUTCOME_UNKNOWN"); }
    public void submissionAccepted() { submission("ACCEPTED"); }
    public void submissionConfirmed() { submission("CONFIRMED"); }
    private void submission(String state) {
        try {
            var invocation = Context.current().get(CURRENT);
            if (enabled() && invocation != null) invocation.workflow.submission(invocation.operation, state);
        } catch (RuntimeException ignored) { }
    }
    /** Preserve an error-bearing result but emit a failure instead of a misleading completion. */
    public void recordHandledFailure(Throwable failure) {
        try {
            var invocation = Context.current().get(CURRENT);
            if (enabled() && invocation != null) {
                invocation.handled = failure;
                invocation.workflow.handled(failure);
            }
        } catch (RuntimeException ignored) { }
    }
    private boolean enabled() { return localLogging || logger != null; }

    private void emit(Invocation invocation, String phase, Throwable failure, boolean handled) {
        try {
            var fields = new LinkedHashMap<String, Object>();
            fields.put("timestamp", Instant.now().toString());
            fields.put("event.name", "recanet.sdk.operation");
            fields.put("recanet.sdk.version", version);
            fields.put("recanet.operation", invocation.operation);
            fields.put("recanet.stage", invocation.operation);
            fields.put("recanet.phase", phase);
            fields.put("recanet.call_id", invocation.id);
            fields.put("recanet.root_call_id", invocation.rootId);
            fields.put("recanet.operation_id", invocation.operationId);
            put(fields, "recanet.parent_call_id", invocation.parentId);
            put(fields, "recanet.partner_id", partnerId);
            put(fields, "deployment.environment.name", environment);
            if (failure != null) {
                fields.put("recanet.failed_stage", invocation.workflow.failureStage(failure, invocation.operation));
                addFailure(fields, failure);
                if (handled) fields.put("recanet.failure_handled", true);
            }
            fields.putAll(invocation.workflow.snapshot());
            if (!"started".equals(phase)) fields.put("recanet.duration_ms", (System.nanoTime() - invocation.started) / 1_000_000.0);
            if (localLogging) {
                try {
                    Level level = failure != null ? Level.WARNING : "started".equals(phase) ? Level.FINE : Level.INFO;
                    if (LOCAL.isLoggable(level)) LOCAL.log(level, JSON.writeValueAsString(fields));
                } catch (Exception ignored) { }
            }
            if (logger != null) {
                try {
                    var attributes = Attributes.builder();
                    fields.forEach((key, value) -> {
                        if (value instanceof Double n) attributes.put(key, n);
                        else if (value instanceof Number n) attributes.put(key, n.longValue());
                        else if (value instanceof Boolean b) attributes.put(key, b);
                        else attributes.put(key, value.toString());
                    });
                    logger.logRecordBuilder().setContext(Context.current())
                            .setSeverity(failure != null ? Severity.ERROR : "started".equals(phase) ? Severity.DEBUG : Severity.INFO)
                            .setBody("recanet.sdk.operation").setAllAttributes(attributes.build()).emit();
                } catch (RuntimeException ignored) { }
            }
        } catch (RuntimeException ignored) { }
    }
    private static void addFailure(Map<String, Object> fields, Throwable failure) {
        String reason = FailureReason.describe(failure);
        fields.put("error.type", failure.getClass().getName());
        fields.put("error.reason", reason);
        fields.put("error.message", ErrorMessage.sanitized(failure, reason));
        String code = failure.getClass().getSimpleName();
        if (failure instanceof DmrvnException e) code = e.code().name();
        else if (failure instanceof PrivyApiException e) {
            code = e.code().name(); fields.put("http.response.status_code", e.statusCode());
        } else if (failure instanceof PrivyAuthenticationException e) code = e.code().name();
        else if (failure instanceof TransactionQueryException e) code = e.code().name();
        else if (failure instanceof io.privy.api.models.errors.APIException e) {
            String upstream = ErrorMessage.upstreamCode(e);
            code = upstream == null ? Integer.toString(e.code()) : upstream;
            fields.put("http.response.status_code", e.code());
        } else if (failure instanceof UpstreamException e) {
            fields.put("recanet.upstream", e.source().name());
            fields.put("http.response.status_code", e.statusCode());
            if (e.code() instanceof Number n) { code = n.toString(); fields.put("recanet.upstream_code", n.longValue()); }
            else if (e.code() instanceof String s && s.matches("[A-Za-z][A-Za-z_]{0,63}")) code = s;
        }
        fields.put("error.code", code);
    }
    private static void put(Map<String, Object> fields, String key, String value) { if (value != null) fields.put(key, value); }
    private static String identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9._:-]{1,128}") ? value : null;
    }
    private static final class Invocation {
        final String id, rootId, parentId, operation, operationId;
        final Workflow workflow;
        final long started = System.nanoTime();
        volatile Throwable handled;
        Invocation(String id, String rootId, String parentId, String operation, String operationId, Workflow workflow) {
            this.id = id; this.rootId = rootId; this.parentId = parentId;
            this.operation = operation; this.operationId = operationId; this.workflow = workflow;
        }
    }
    private static final class Workflow {
        private String lastStage = "NONE", submissionTarget = "NONE", submissionState = "NOT_ATTEMPTED";
        private State state = State.NOT_STARTED;
        private Throwable lastFailure;
        private Throwable handledFailure;
        private String failedStage;
        synchronized void completed(String stage) { lastStage = stage; if (state == State.NOT_STARTED) state = State.STEP_COMPLETED; }
        synchronized boolean checkpoint(String stage, State next) {
            if (state == next && lastStage.equals(stage)) return false;
            state = Objects.requireNonNull(next); lastStage = stage; return true;
        }
        synchronized void submission(String target, String value) { submissionTarget = target; submissionState = value; }
        synchronized void handled(Throwable failure) { handledFailure = failure; }
        synchronized Throwable handled() { return handledFailure; }
        synchronized String failureStage(Throwable failure, String stage) {
            Throwable candidate = failure;
            for (int i = 0; candidate != null && i < 8; i++, candidate = candidate.getCause())
                if (candidate == lastFailure) return failedStage;
            lastFailure = failure; failedStage = stage;
            if (failure instanceof UpstreamException e && submissionState.equals("OUTCOME_UNKNOWN") && submissionTarget.equals(stage)) {
                if (e.definitelyNotBroadcast()) submissionState = "NOT_BROADCAST";
                else if (e.definitelyRejected()) submissionState = "REJECTED";
            }
            if (failure instanceof io.privy.api.models.errors.APIException e
                    && submissionState.equals("OUTCOME_UNKNOWN") && submissionTarget.equals(stage)
                    && java.util.Set.of(400, 401, 403, 404, 422).contains(e.code())) submissionState = "REJECTED";
            return stage;
        }
        synchronized Map<String, Object> snapshot() {
            return Map.of("recanet.last_confirmed_stage", lastStage, "recanet.last_confirmed_state", state.name(),
                    "recanet.submission_target", submissionTarget, "recanet.submission_state", submissionState);
        }
    }
    public static final class Builder {
        private OpenTelemetry openTelemetry;
        private boolean localLogging = true;
        private String partnerId, environment;
        private Builder() {}
        public Builder openTelemetry(OpenTelemetry value) { openTelemetry = Objects.requireNonNull(value); return this; }
        public Builder localLogging(boolean value) { localLogging = value; return this; }
        /** SDK spans are always disabled; retained only for source compatibility. */
        @Deprecated public Builder tracing(boolean ignored) { return this; }
        public Builder partnerId(String value) { partnerId = requireIdentifier(value); return this; }
        public Builder environment(String value) { environment = requireIdentifier(value); return this; }
        public SdkTelemetry build() { return new SdkTelemetry(this); }
        private static String requireIdentifier(String value) {
            if (identifier(value) == null) throw new IllegalArgumentException("Invalid telemetry label");
            return value;
        }
    }
}
