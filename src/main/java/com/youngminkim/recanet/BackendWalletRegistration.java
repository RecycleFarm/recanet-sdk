package com.youngminkim.recanet;

import java.util.Objects;

/**
 * Public/private key pair used to register and authorize a backend-owned wallet.
 * The private key is never sent as part of wallet registration and is redacted
 * from {@link #toString()}.
 *
 * @param publicKey the public key registered as the Privy wallet owner
 * @param privateKey the corresponding authorization private key
 */
public record BackendWalletRegistration(String publicKey, String privateKey) {
    public BackendWalletRegistration {
        publicKey = requireText(publicKey, "publicKey");
        privateKey = requireText(privateKey, "privateKey");
    }

    @Override
    public String toString() {
        return "BackendWalletRegistration[publicKey=" + publicKey + ", privateKey=[REDACTED]]";
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }
}
