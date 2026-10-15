package com.youngminkim.recanet;

/** A transaction read failed. Messages never contain RPC URLs, credentials or response bodies. */
public final class TransactionQueryException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public enum Code {
        RPC_UNAVAILABLE,
        INVALID_RESPONSE,
        WRONG_CHAIN,
        /** The chain changed or the RPC returned inconsistent snapshots. Restart the query. */
        CHAIN_CHANGED,
        INTERRUPTED
    }

    private final Code code;

    TransactionQueryException(Code code) {
        super("Transaction query failed: " + code);
        this.code = code;
    }

    public Code code() { return code; }
}
