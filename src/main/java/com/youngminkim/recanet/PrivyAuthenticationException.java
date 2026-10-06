package com.youngminkim.recanet;

/** Authentication failure with a stable code and no token or upstream response in its message. */
public final class PrivyAuthenticationException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    /** Distinguishes invalid credentials from an unavailable verification key source. */
    public enum Code {
        /** No token or authorization header was supplied. */
        MISSING_TOKEN,
        /** The token, signature, header, or claims are invalid. */
        INVALID_TOKEN,
        /** The access token has expired. */
        EXPIRED_TOKEN,
        /** JWKS retrieval failed; authentication must not succeed. */
        KEY_SOURCE_UNAVAILABLE
    }

    /** @serial Stable authentication error classification. */
    private final Code code;

    PrivyAuthenticationException(Code code) {
        super(switch (code) {
            case MISSING_TOKEN -> "Privy access token is required";
            case INVALID_TOKEN -> "Privy access token is invalid";
            case EXPIRED_TOKEN -> "Privy access token has expired";
            case KEY_SOURCE_UNAVAILABLE -> "Privy verification keys are unavailable";
        });
        this.code = code;
    }

    /** @return the stable authentication error code */
    public Code code() { return code; }
}
