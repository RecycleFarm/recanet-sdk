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

    public DmrvnException(Code code) {
        this(code, false);
    }

    DmrvnException(Code code, boolean definitelyNotBroadcast) {
        this(code, definitelyNotBroadcast, false);
    }

    DmrvnException(Code code, boolean definitelyNotBroadcast, boolean definitelyRejected) {
        super(code.name());
        this.code = code;
        this.definitelyNotBroadcast = definitelyNotBroadcast;
        this.definitelyRejected = definitelyRejected;
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
}
