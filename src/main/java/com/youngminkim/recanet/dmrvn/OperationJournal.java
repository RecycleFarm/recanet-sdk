package com.youngminkim.recanet.dmrvn;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Optional partner-owned journal for the step APIs. Return detached JSON snapshots; durable writes
 * are the adapter's responsibility. The SDK does not guarantee recovery or exactly-once execution.
 * For durable adapters, writes must be durable before
 * returning. withLock must serialize across workers and fence writes/side effects when ownership is
 * lost. Keys include activity workflow, operation, source-event, beneficiary and Relay reservations.
 * No private keys belong here.
 */
public interface OperationJournal {
    <T> T withLock(String key, Supplier<T> action);

    Map<String, Object> load(String key);

    /**
     * All operation records for this claimId across deployments, including pre-index records.
     * Called under the global claim-id lock; database adapters must query a shared claimId index.
     * Missing support fails closed instead of permitting cross-deployment duplicates.
     */
    default List<Map<String, Object>> findOperationsByClaimId(String claimId) {
        throw new DmrvnException(DmrvnException.Code.JOURNAL_UNAVAILABLE);
    }

    void store(String key, Map<String, Object> snapshot);
}
