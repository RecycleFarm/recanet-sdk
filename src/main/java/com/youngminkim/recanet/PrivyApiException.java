package com.youngminkim.recanet;

import java.time.Duration;
import java.util.Optional;

/** SDK-generated Privy integration validation failure. Remote API errors propagate as APIException. */
public final class PrivyApiException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    /** Stable server API failure codes. */
    public enum Code {
        /** Privy rejected the app credentials. */
        INVALID_CREDENTIALS,
        /** Credentials do not grant access to the requested API. */
        FORBIDDEN,
        /** Privy returned HTTP 429. */
        RATE_LIMITED,
        /** Network or upstream service unavailable. */
        UNAVAILABLE,
        /** Unexpected API status or response format. */
        INVALID_RESPONSE,
        /** The calling thread was interrupted. */
        INTERRUPTED
    }

    /** @serial Stable API error classification. */
    private final Code code;
    /** @serial HTTP status, or zero when no response was received. */
    private final int statusCode;
    /** @serial Optional upstream retry delay. */
    private final Duration retryAfter;

    PrivyApiException(Code code, int statusCode, Duration retryAfter) {
        super("Privy API request failed: " + code);
        this.code = code;
        this.statusCode = statusCode;
        this.retryAfter = retryAfter;
    }

    /** @return the stable API error code */
    public Code code() { return code; }
    /** @return upstream HTTP status, or zero when there was no response */
    public int statusCode() { return statusCode; }
    /** @return the parsed Retry-After delay when available */
    public Optional<Duration> retryAfter() { return Optional.ofNullable(retryAfter); }
}
