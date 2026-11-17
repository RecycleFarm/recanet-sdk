package com.youngminkim.recanet;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

/** Trusted public-key configuration for Privy-issued access tokens. */
public final class PrivyTokenVerificationConfig {
    private final URI jwksUri;
    private final String verificationKeyPem;
    private final Duration clockSkew;
    private final Duration jwksTimeout;
    private final Duration cacheTtl;
    private final Duration refreshCooldown;

    private PrivyTokenVerificationConfig(URI jwksUri, String verificationKeyPem, Duration clockSkew,
                                        Duration jwksTimeout, Duration cacheTtl, Duration refreshCooldown) {
        this.jwksUri = jwksUri;
        this.verificationKeyPem = verificationKeyPem;
        this.clockSkew = Objects.requireNonNull(clockSkew, "clockSkew");
        this.jwksTimeout = positiveMillis(jwksTimeout, "jwksTimeout");
        this.cacheTtl = positiveMillis(cacheTtl, "cacheTtl");
        this.refreshCooldown = positiveMillis(refreshCooldown, "refreshCooldown");
        if (clockSkew.isNegative() || clockSkew.compareTo(Duration.ofMinutes(1)) > 0) {
            throw new IllegalArgumentException("clockSkew must be between zero and one minute");
        }
        if (cacheTtl.toMillis() <= refreshCooldown.toMillis()) {
            throw new IllegalArgumentException("cacheTtl must be greater than refreshCooldown");
        }
        if (jwksTimeout.toMillis() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("jwksTimeout is too large");
        }
    }

    /**
     * Uses the trusted JWKS URL shown in your Privy Dashboard. It is never read from a JWT header.
     * @param uri HTTPS JWKS URL, or a loopback HTTP URL for local testing
     * @return configuration with a five-minute cache and 30-second refresh cooldown
     */
    public static PrivyTokenVerificationConfig usingJwks(URI uri) {
        Objects.requireNonNull(uri, "jwksUri");
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getFragment() != null
                || (!"https".equalsIgnoreCase(uri.getScheme())
                && !("http".equalsIgnoreCase(uri.getScheme()) && isLoopback(uri.getHost())))) {
            throw new IllegalArgumentException("jwksUri must use HTTPS (HTTP is allowed only on loopback)");
        }
        return defaults(uri, null);
    }

    /**
     * Uses the PEM verification public key from your Privy Dashboard without network requests.
     * @param pem SPKI PEM-encoded P-256 public key
     * @return configuration for offline verification
     */
    public static PrivyTokenVerificationConfig usingPublicKey(String pem) {
        if (pem == null || pem.isBlank()) {
            throw new IllegalArgumentException("verificationKeyPem must not be blank");
        }
        return defaults(null, pem);
    }

    /**
     * Sets the tolerated clock difference. The default is zero.
     * @param skew duration from zero through one minute
     * @return a new configuration
     */
    public PrivyTokenVerificationConfig withClockSkew(Duration skew) {
        return new PrivyTokenVerificationConfig(jwksUri, verificationKeyPem, skew,
                jwksTimeout, cacheTtl, refreshCooldown);
    }

    /**
     * Tunes network and cache bounds. Retrieval has no background scheduler or retry loop.
     * @param timeout connect and read timeout, each positive and at least one millisecond
     * @param ttl public-key cache lifetime, greater than the cooldown
     * @param cooldown refresh rate-limit interval, positive and at least one millisecond
     * @return a new configuration
     */
    public PrivyTokenVerificationConfig withJwksPolicy(Duration timeout, Duration ttl, Duration cooldown) {
        return new PrivyTokenVerificationConfig(jwksUri, verificationKeyPem, clockSkew, timeout, ttl, cooldown);
    }

    /** @return allowed clock difference */
    public Duration clockSkew() { return clockSkew; }
    /** @return JWKS connection and read timeout */
    public Duration jwksTimeout() { return jwksTimeout; }
    /** @return public-key cache lifetime */
    public Duration cacheTtl() { return cacheTtl; }
    /** @return refresh rate-limit interval */
    public Duration refreshCooldown() { return refreshCooldown; }

    URI jwksUri() { return jwksUri; }
    String verificationKeyPem() { return verificationKeyPem; }

    static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)
                || "[::1]".equals(host) || "::1".equals(host);
    }

    private static PrivyTokenVerificationConfig defaults(URI uri, String pem) {
        return new PrivyTokenVerificationConfig(uri, pem, Duration.ZERO,
                Duration.ofSeconds(5), Duration.ofMinutes(5), Duration.ofSeconds(30));
    }

    private static Duration positiveMillis(Duration value, String name) {
        Objects.requireNonNull(value, name);
        try {
            if (value.isNegative() || value.toMillis() < 1) {
                throw new IllegalArgumentException(name + " must be at least one millisecond");
            }
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException(name + " is too large");
        }
        return value;
    }
}
