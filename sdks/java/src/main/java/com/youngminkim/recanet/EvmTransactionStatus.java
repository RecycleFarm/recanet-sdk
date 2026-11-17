package com.youngminkim.recanet;

/** A point-in-time execution status. Confirmations do not imply consensus or L1 finality. */
public record EvmTransactionStatus(
        long chainId, String transactionHash, State state, Long blockNumber, long confirmations) {
    public enum State {
        /** This RPC does not know the hash; this is not proof of failure or replacement. */
        NOT_FOUND,
        /** The RPC knows the transaction, but it has no block yet. */
        PENDING,
        /** In a canonical block, but its receipt has no available execution status yet. */
        MINED,
        /** Receipt status is 1. */
        SUCCEEDED,
        /** Receipt status is 0. */
        REVERTED
    }
}
