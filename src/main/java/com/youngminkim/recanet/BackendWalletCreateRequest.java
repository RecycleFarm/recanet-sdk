package com.youngminkim.recanet;

import java.util.Objects;

/** Parameters used when creating a Privy wallet owned by a backend public key. */
public record BackendWalletCreateRequest(String chainType, String displayName, String externalId) {
    public BackendWalletCreateRequest {
        chainType = requireText(chainType, "chainType");
        if (displayName != null && displayName.isBlank()) displayName = null;
        if (externalId != null && externalId.isBlank()) externalId = null;
    }

    public BackendWalletCreateRequest(String chainType) {
        this(chainType, null, null);
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }
}
