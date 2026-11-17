package com.youngminkim.recanet;

/**
 * Inclusive block range and pagination. A null toBlock snapshots the latest block on the first
 * page. Reuse the same range and the returned cursor on subsequent pages. Pending transactions
 * are queried individually and are not part of block history.
 */
public record EvmTransactionQuery(long fromBlock, Long toBlock, int limit, String cursor) {
    public EvmTransactionQuery {
        if (fromBlock < 0 || (toBlock != null && toBlock < fromBlock))
            throw new IllegalArgumentException("Invalid transaction block range");
        if (limit < 1 || limit > 100)
            throw new IllegalArgumentException("limit must be between 1 and 100");
        if (cursor != null && (cursor.isBlank() || cursor.length() > 2048))
            throw new IllegalArgumentException("Invalid transaction cursor");
    }

    public EvmTransactionQuery(long fromBlock, Long toBlock, int limit) {
        this(fromBlock, toBlock, limit, null);
    }

    public EvmTransactionQuery withCursor(String nextCursor) {
        return new EvmTransactionQuery(fromBlock, toBlock, limit, nextCursor);
    }
}
