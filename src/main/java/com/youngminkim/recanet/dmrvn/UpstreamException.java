package com.youngminkim.recanet.dmrvn;

/** An external service error, preserving its code, message and response without SDK classification. */
public final class UpstreamException extends RuntimeException {
    public enum Source { EVM_RPC, GREENFIELD }

    private final Source source;
    private final Object code;
    private final int statusCode;
    private final String responseBody;
    private final boolean definitelyNotBroadcast;
    private final boolean definitelyRejected;

    public UpstreamException(Source source, Object code, int statusCode, String message,
                             String responseBody) {
        this(source, code, statusCode, message, responseBody, false, false);
    }

    UpstreamException(Source source, Object code, int statusCode, String message,
                      String responseBody, boolean definitelyNotBroadcast, boolean definitelyRejected) {
        super(message);
        this.source = source;
        this.code = code;
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.definitelyNotBroadcast = definitelyNotBroadcast;
        this.definitelyRejected = definitelyRejected;
    }

    public Source source() { return source; }
    static UpstreamException transport(Source source, Throwable error) {
        while ((error instanceof java.util.concurrent.ExecutionException
                || error instanceof java.util.concurrent.CompletionException) && error.getCause() != null)
            error = error.getCause();
        var failure = new UpstreamException(source, null, 0, error.getMessage(), null);
        failure.initCause(error);
        return failure;
    }
    /** Original service code, or null if the response has no code. */
    public Object code() { return code; }
    /** HTTP status, or zero for the local Greenfield worker protocol. */
    public int statusCode() { return statusCode; }
    public String responseBody() { return responseBody; }
    public boolean definitelyNotBroadcast() { return definitelyNotBroadcast; }
    public boolean definitelyRejected() { return definitelyRejected; }
}
