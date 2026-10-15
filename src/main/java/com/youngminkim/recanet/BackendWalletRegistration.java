package com.youngminkim.recanet;

import java.util.Objects;
import java.util.Base64;

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

    /** Returns the PKCS#8 Base64 form expected by Privy's Java request signer. */
    String privyPrivateKey() {
        String value = privateKey.replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s", "");
        try {
            Base64.getDecoder().decode(value);
            return value;
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("privateKey must be PKCS#8 Base64 or PEM", e);
        }
    }

    /** Loads the pair from environment variables without logging either key. */
    public static BackendWalletRegistration fromEnvironment() {
        return new BackendWalletRegistration(
                requiredEnvironment("BACKEND_WALLET_PUBLIC_KEY"),
                requiredEnvironment("BACKEND_WALLET_PRIVATE_KEY"));
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

    private static String requiredEnvironment(String name) {
        return requireText(System.getenv(name), name);
    }
}
