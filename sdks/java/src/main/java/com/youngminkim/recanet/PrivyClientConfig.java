package com.youngminkim.recanet;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

/** Immutable server credentials and connection settings for the Privy wrapper. */
public final class PrivyClientConfig {
    private final String appId;
    private final String appSecret;
    private final URI baseUri;
    private final Duration requestTimeout;
    private final PrivyTokenVerificationConfig tokenVerification;

    /**
     * Uses Privy's production API and a 30-second request timeout.
     * @param appId Privy app ID
     * @param appSecret Privy server app secret
     */
    public PrivyClientConfig(String appId, String appSecret) {
        this(appId, appSecret, URI.create("https://api.privy.io"), Duration.ofSeconds(30));
    }

    /**
     * Creates a configuration with explicit connection settings.
     * @param appId Privy app ID
     * @param appSecret Privy server app secret
     * @param baseUri absolute HTTP(S) API origin without a path, query, or fragment
     * @param requestTimeout positive default timeout for SDK requests
     */
    public PrivyClientConfig(String appId, String appSecret, URI baseUri, Duration requestTimeout) {
        this(appId, appSecret, baseUri, requestTimeout, null);
    }

    private PrivyClientConfig(String appId, String appSecret, URI baseUri, Duration requestTimeout,
                             PrivyTokenVerificationConfig tokenVerification) {
        this.appId = requireText(appId, "appId");
        this.appSecret = requireText(appSecret, "appSecret");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
        this.requestTimeout = Objects.requireNonNull(requestTimeout, "requestTimeout");
        this.tokenVerification = tokenVerification;
        if ((!"https".equalsIgnoreCase(baseUri.getScheme()) && !"http".equalsIgnoreCase(baseUri.getScheme()))
                || baseUri.getHost() == null || baseUri.getUserInfo() != null
                || (baseUri.getPath() != null && !baseUri.getPath().isEmpty())
                || baseUri.getQuery() != null || baseUri.getFragment() != null) {
            throw new IllegalArgumentException("baseUri must be an HTTP(S) API origin without a path, query, or fragment");
        }
        if ("http".equalsIgnoreCase(baseUri.getScheme())
                && !PrivyTokenVerificationConfig.isLoopback(baseUri.getHost())) {
            throw new IllegalArgumentException("baseUri must use HTTPS (HTTP is allowed only on loopback)");
        }
        if (appId.indexOf(':') >= 0
                || appId.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c))) {
            throw new IllegalArgumentException("appId must not contain a colon, whitespace, or control characters");
        }
        try {
            if (requestTimeout.isNegative() || requestTimeout.toMillis() < 1) {
                throw new IllegalArgumentException("requestTimeout must be at least one millisecond");
            }
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("requestTimeout is too large");
        }
    }

    /**
     * Enables local verification of inbound Privy access tokens.
     * @param verification trusted JWKS or public-key configuration
     * @return a new immutable client configuration
     */
    public PrivyClientConfig withTokenVerification(PrivyTokenVerificationConfig verification) {
        return new PrivyClientConfig(appId, appSecret, baseUri, requestTimeout,
                Objects.requireNonNull(verification, "tokenVerification"));
    }

    /** @return the Privy app ID */
    public String appId() { return appId; }
    /** @return the server secret; do not log this value */
    public String appSecret() { return appSecret; }
    /** @return the API origin */
    public URI baseUri() { return baseUri; }
    /** @return the default request timeout */
    public Duration requestTimeout() { return requestTimeout; }

    PrivyTokenVerificationConfig tokenVerification() { return tokenVerification; }

    @Override
    public String toString() {
        return "PrivyClientConfig[appId=" + appId + ", appSecret=[REDACTED], baseUri=" + baseUri
                + ", requestTimeout=" + requestTimeout + "]";
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
        return value;
    }
}
