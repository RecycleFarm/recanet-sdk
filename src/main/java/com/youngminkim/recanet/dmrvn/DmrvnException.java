package com.youngminkim.recanet.dmrvn;

/** Stable application error; never includes upstream bodies or credentials. */
public final class DmrvnException extends RuntimeException {
    public enum Code {
        INVALID_INPUT,
        EVIDENCE_CONTRACT_UNCONFIGURED,
        WRONG_CHAIN,
        DEPLOYMENT_MISMATCH,
        DEPLOYMENT_NOT_READY,
        UNAPPROVED_IMPLEMENTATION,
        DEPLOYMENT_COLLISION,
        UNAUTHORIZED_SIGNER,
        OPERATION_INPUT_CHANGED,
        OPERATION_NOT_PREPARED,
        SUBMISSION_INPUT_CHANGED,
        SUBMISSION_UNRESOLVED,
        STORAGE_ACCESS_DENIED,
        OBJECT_UNSEALED,
        STORAGE_UNAVAILABLE,
        STORAGE_CREATE_UNRESOLVED,
        STORAGE_ACCOUNT_UNFUNDED,
        STORAGE_MISMATCH,
        SIGNATURE_INVALID,
        REQUEST_EXPIRED,
        NONCE_CONFLICT,
        INSUFFICIENT_FUNDS,
        GAS_ESTIMATION_FAILED,
        RPC_UNAVAILABLE,
        REPORT_LOOKUP_RANGE,
        REPORT_TX_NOT_FOUND,
        REPORT_READ_FAILED,
        REPORT_MISMATCH,
        JOURNAL_UNAVAILABLE,
        INTERRUPTED,
        METHODOLOGY_UNAVAILABLE
    }

    private final Code code;
    private final boolean definitelyNotBroadcast;
    private final boolean definitelyRejected;
    private final String inputField;
    private final String inputReason;

    public DmrvnException(Code code) {
        this(code, false);
    }

    DmrvnException(Code code, boolean definitelyNotBroadcast) {
        this(code, definitelyNotBroadcast, false);
    }

    DmrvnException(Code code, boolean definitelyNotBroadcast, boolean definitelyRejected) {
        this(code, code.name(), definitelyNotBroadcast, definitelyRejected, null, null);
    }

    public DmrvnException(Code code, String message) {
        this(code, message, false, false, null, null);
    }

    private DmrvnException(Code code, String message, boolean definitelyNotBroadcast,
                           boolean definitelyRejected, String inputField, String inputReason) {
        super(message);
        this.code = code;
        this.definitelyNotBroadcast = definitelyNotBroadcast;
        this.definitelyRejected = definitelyRejected;
        this.inputField = inputField;
        this.inputReason = inputReason;
    }

    /** True only for a storage adapter failure proven to precede broadcast. */
    public boolean definitelyNotBroadcast() {
        return definitelyNotBroadcast;
    }

    /** True only for a storage transaction explicitly rejected by CheckTx before acceptance. */
    public boolean definitelyRejected() {
        return definitelyRejected;
    }

    public Code code() {
        return code;
    }

    public boolean retryable() {
        return switch (code) {
            case SUBMISSION_UNRESOLVED,
                    STORAGE_CREATE_UNRESOLVED,
                    OBJECT_UNSEALED,
                    STORAGE_UNAVAILABLE,
                    RPC_UNAVAILABLE,
                    REPORT_TX_NOT_FOUND,
                    REPORT_READ_FAILED,
                    JOURNAL_UNAVAILABLE,
                    METHODOLOGY_UNAVAILABLE -> true;
            default -> false;
        };
    }

    public String action() {
        return switch (code) {
            case SUBMISSION_UNRESOLVED, STORAGE_CREATE_UNRESOLVED -> "RECONCILE_ONLY";
            case STORAGE_ACCOUNT_UNFUNDED, INSUFFICIENT_FUNDS -> "FUND_CONFIGURED_ROLE";
            default -> retryable() ? "RETRY_SAME_OPERATION" : "FIX_INPUT_OR_CONFIGURATION";
        };
    }

    static void require(boolean condition, Code code) {
        if (!condition) throw new DmrvnException(code);
    }

    static void require(boolean condition, Code code, String field, String reason) {
        if (!condition) {
            if (code == Code.INVALID_INPUT) throw invalidInput(field, reason);
            throw new DmrvnException(code, code.name() + ": " + field + ": " + reason);
        }
    }

    static DmrvnException invalidInput(String field, String reason) {
        return new DmrvnException(Code.INVALID_INPUT, "INVALID_INPUT: " + field + ": " + reason,
                false, false, field, reason);
    }

    /** Adds the caller's field path without copying rejected values or upstream messages. */
    static <T> T input(String field, java.util.function.Supplier<T> operation) {
        try {
            return operation.get();
        } catch (DmrvnException e) {
            if (e.code != Code.INVALID_INPUT) throw e;
            String nested = e.inputField;
            String path = nested == null || nested.equals("value") || nested.equals("$")
                    || nested.equals(field) ? field
                    : nested.startsWith("$") ? field + nested.substring(1) : field + "." + nested;
            throw invalidInput(path, e.inputReason == null ? "failed input validation" : e.inputReason);
        }
    }
}
