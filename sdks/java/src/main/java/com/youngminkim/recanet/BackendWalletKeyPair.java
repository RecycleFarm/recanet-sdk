package com.youngminkim.recanet;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * A generated P-256 authorization key pair for a backend wallet.
 * Keep the private key in a secret manager. The explicit {@link #generateAndLog()} bootstrap
 * method is the only method that logs it.
 */
public record BackendWalletKeyPair(String publicKey, String privateKey) {
    private static final String CURVE = "secp256r1";
    private static final Logger LOGGER = Logger.getLogger(BackendWalletKeyPair.class.getName());

    /** Generates a cryptographically secure P-256 key pair. */
    public static BackendWalletKeyPair generate() {
        try {
            var generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec(CURVE));
            return from(generator.generateKeyPair());
        } catch (NoSuchAlgorithmException | java.security.InvalidAlgorithmParameterException e) {
            throw new IllegalStateException("P-256 key generation is unavailable", e);
        }
    }

    /**
     * Generates a key pair and logs both PEM values for one-time partner bootstrap.
     * Use only in a controlled setup environment; never call this in normal production startup.
     */
    public static BackendWalletKeyPair generateAndLog() {
        var keys = generate();
        LOGGER.log(Level.WARNING, "BACKEND_WALLET_PUBLIC_KEY={0}", keys.publicKey());
        LOGGER.log(Level.WARNING, "BACKEND_WALLET_PRIVATE_KEY={0}", keys.privateKey());
        return keys;
    }

    /** Converts this pair into the registration object used by {@link PrivyClient}. */
    public BackendWalletRegistration registration() {
        return new BackendWalletRegistration(publicKey, privateKey);
    }

    @Override
    public String toString() {
        return "BackendWalletKeyPair[publicKey=" + publicKey + ", privateKey=[REDACTED]]";
    }

    private static BackendWalletKeyPair from(KeyPair pair) {
        return new BackendWalletKeyPair(
                pem("PUBLIC KEY", pair.getPublic().getEncoded()),
                pem("PRIVATE KEY", pair.getPrivate().getEncoded()));
    }

    private static String pem(String label, byte[] encoded) {
        String body = Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(encoded);
        return "-----BEGIN " + label + "-----\n" + body + "\n-----END " + label + "-----";
    }
}
