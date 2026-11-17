package com.youngminkim.recanet.dmrvn;

import java.util.Map;

/** Greenfield signer/storage boundary. All reads must fetch actual objects, not database copies. */
public interface GreenfieldStorage {
    record Head(boolean exists, boolean sealed) {}

    String address();

    /** Identifies the configured Greenfield network. */
    String chainId();

    Head head(Map<String, Object> location);

    /** Creates a private object once, returning the original CreateObject transaction hash. */
    String create(Map<String, Object> location, byte[] bytes);

    /** Reuses the original CreateObject hash; never creates an object. */
    void upload(Map<String, Object> location, byte[] bytes, String createTxHash);

    byte[] read(Map<String, Object> location);

    /** Read-only proof that the supplied transaction created this object by this uploader. */
    boolean matchesCreateTransaction(Map<String, Object> location, String createTxHash);
}
