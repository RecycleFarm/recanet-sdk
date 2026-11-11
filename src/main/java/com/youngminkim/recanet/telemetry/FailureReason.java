package com.youngminkim.recanet.telemetry;

import com.youngminkim.recanet.PrivyApiException;
import com.youngminkim.recanet.PrivyAuthenticationException;
import com.youngminkim.recanet.TransactionQueryException;
import com.youngminkim.recanet.dmrvn.DmrvnException;
import com.youngminkim.recanet.dmrvn.UpstreamException;

/** Fixed explanations only: never inspect a throwable's message or arbitrary upstream payload. */
final class FailureReason {
    private FailureReason() {}

    static String describe(Throwable failure) {
        // Recognize transport causes through bounded wrapper chains without exporting their text.
        Throwable cause = failure;
        for (int i = 0; cause != null && i < 8; i++, cause = cause.getCause()) {
            if (cause instanceof java.net.http.HttpTimeoutException
                    || cause instanceof java.net.SocketTimeoutException
                    || cause instanceof java.util.concurrent.TimeoutException)
                return "The external request timed out; its final outcome may be unknown";
            if (cause instanceof InterruptedException)
                return "The operation was interrupted";
            if (cause instanceof java.net.ConnectException || cause instanceof java.net.UnknownHostException)
                return "Could not connect to the external service";
            if (cause instanceof javax.net.ssl.SSLException)
                return "TLS connection to the external service failed";
        }
        if (failure instanceof DmrvnException e) return code(e.code().name());
        if (failure instanceof PrivyAuthenticationException e) return code(e.code().name());
        if (failure instanceof TransactionQueryException e) return code(e.code().name());
        if (failure instanceof PrivyApiException e)
            return e.statusCode() > 0 ? http(e.statusCode()) : code(e.code().name());
        if (failure instanceof io.privy.api.models.errors.APIException e) return http(e.code());
        if (failure instanceof UpstreamException e) {
            if (e.statusCode() >= 400) return http(e.statusCode());
            if (e.code() instanceof Number number) {
                return switch (number.intValue()) {
                    case -32700 -> "The RPC service could not parse the request";
                    case -32601 -> "The RPC service does not support the requested method";
                    case -32602 -> "The RPC service rejected the method parameters";
                    default -> "The external service returned an error; inspect the numeric upstream code";
                };
            }
            return "The external service or its transport failed; no safe detailed reason is available";
        }
        if (failure instanceof IllegalArgumentException || failure instanceof NullPointerException)
            return "A required input is missing or invalid";
        if (failure instanceof java.io.IOException)
            return "Communication with the external service failed";
        return "The operation failed; no safe detailed reason is available";
    }

    private static String http(int status) {
        return switch (status) {
            case 400, 422 -> "The external service rejected the request parameters";
            case 401 -> "The external service rejected authentication credentials";
            case 403 -> "The external service denied permission for this operation";
            case 404 -> "The external service could not find the requested resource";
            case 409 -> "The operation conflicts with existing external service state";
            case 408, 504 -> "The external request timed out; its final outcome may be unknown";
            case 429 -> "The external service rate limit was exceeded";
            default -> status >= 500 ? "The external service reported a server error"
                    : "The external service returned an unexpected response";
        };
    }

    private static String code(String code) {
        return switch (code) {
            case "SUBMISSION_UNRESOLVED", "STORAGE_CREATE_UNRESOLVED" ->
                    "Submission outcome is unknown; verify the original transaction before retrying";
            case "WRONG_CHAIN" -> "The RPC network does not match the configured chain";
            case "UNAUTHORIZED_SIGNER", "FORBIDDEN" -> "The signer or credentials lack permission";
            case "INVALID_CREDENTIALS", "INVALID_TOKEN", "MISSING_TOKEN", "EXPIRED_TOKEN" ->
                    "Authentication credentials are missing, invalid or expired";
            case "INVALID_INPUT" -> "A required input is missing or invalid";
            case "INTERRUPTED" -> "The operation was interrupted";
            case "NONCE_CONFLICT" -> "The nonce is already reserved by a different operation";
            case "INSUFFICIENT_FUNDS", "STORAGE_ACCOUNT_UNFUNDED" -> "The spending account has insufficient funds";
            case "OBJECT_UNSEALED" -> "The storage object has not been sealed yet";
            case "STORAGE_MISMATCH" -> "Stored evidence does not match the expected data";
            case "SIGNATURE_INVALID" -> "Signature verification failed";
            case "REQUEST_EXPIRED" -> "The signed request has expired";
            case "RPC_UNAVAILABLE", "UNAVAILABLE" -> "The external service is unavailable or returned invalid data";
            case "RATE_LIMITED" -> "The external service rate limit was exceeded";
            default -> "SDK validation failed: " + code;
        };
    }
}
