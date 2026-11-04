package com.youngminkim.recanet.dmrvn;

import java.util.*;
import java.util.function.Supplier;

/** Volatile step state only. No disk, cross-process coordination or restart recovery. */
final class MemoryOperationJournal implements OperationJournal {
    private final Map<String, Map<String, Object>> states = new HashMap<>();

    @Override public synchronized <T> T withLock(String key, Supplier<T> action) {
        return action.get();
    }

    @Override public synchronized Map<String, Object> load(String key) {
        var value = states.get(key);
        return value == null ? null : Json.copy(value);
    }

    @Override public synchronized void store(String key, Map<String, Object> snapshot) {
        states.put(key, Json.copy(snapshot));
    }

    @Override public synchronized List<Map<String, Object>> findOperationsByClaimId(String claimId) {
        return states.entrySet().stream()
                .filter(e -> e.getKey().startsWith("operation:"))
                .map(Map.Entry::getValue)
                .filter(s -> claimId.equals(s.get("claimId")))
                .map(Json::copy).toList();
    }
}
