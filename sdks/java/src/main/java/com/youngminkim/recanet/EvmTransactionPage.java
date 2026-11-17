package com.youngminkim.recanet;

import java.util.List;

/**
 * Outgoing transactions ordered by descending block number and transaction index. A page can be
 * empty and still have a nextCursor: each call scans at most 100 blocks. fromBlock/toBlock describe
 * the fixed search range, not just this page. Only a null nextCursor means the range is exhausted.
 */
public record EvmTransactionPage(
        List<EvmTransaction> transactions, String nextCursor,
        long fromBlock, long toBlock, int scannedBlocks) {
    public EvmTransactionPage { transactions = List.copyOf(transactions); }
}
