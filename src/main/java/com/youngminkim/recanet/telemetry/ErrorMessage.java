package com.youngminkim.recanet.telemetry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.youngminkim.recanet.dmrvn.UpstreamException;
import java.util.regex.Pattern;

/** Extracts a bounded message, never the whole response, headers or stack trace. */
final class ErrorMessage {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_INPUT = 16_384;
    private static final Pattern PEM = Pattern.compile("-----BEGIN [^-]+-----.*?(?:-----END [^-]+-----|$)", Pattern.DOTALL);
    private static final Pattern URL = Pattern.compile("(?i)https?://[^\\s<>\"']+");
    private static final Pattern AUTH = Pattern.compile("(?i)\\b(?:Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]+");
    private static final Pattern JWT = Pattern.compile("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b");
    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)\\b(?:[\"']?(?:authorization|cookie|set-cookie|[a-z_]*(?:token|secret|password|private[ _-]?key|api[ _-]?key|signature))[\"']?\\s*[:=]\\s*)(?:\"[^\"]*\"|'[^']*'|[^,;\\s}]+)");
    private static final Pattern OPAQUE = Pattern.compile("(?<![A-Za-z0-9])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9])");
    private static final Pattern HEX = Pattern.compile("(?i)\\b0x[0-9a-f]{16,}\\b");

    private ErrorMessage() {}

    static String upstreamCode(io.privy.api.models.errors.APIException error) {
        String value = error.bodyAsString().orElse(null);
        if (value == null || value.length() > MAX_INPUT) return null;
        try {
            JsonNode root = JSON.readTree(value);
            for (JsonNode node : new JsonNode[]{root.path("error").path("code"), root.path("code"), root.path("error_code")}) {
                if (node.isIntegralNumber()) return node.asText();
                if (node.isTextual() && node.asText().matches("[A-Za-z][A-Za-z_]{0,63}")) return node.asText();
            }
        } catch (Exception ignored) { }
        return null;
    }

    static String sanitized(Throwable failure, String fallback) {
        String message = null;
        if (failure instanceof io.privy.api.models.errors.APIException e)
            message = e.bodyAsString().map(ErrorMessage::extractJson).orElse(null);
        else if (failure instanceof UpstreamException e)
            message = java.util.Objects.equals(e.getMessage(), e.responseBody())
                    ? extractJson(e.getMessage()) : extract(e.getMessage());
        else if (failure instanceof com.youngminkim.recanet.dmrvn.DmrvnException
                || failure instanceof com.youngminkim.recanet.PrivyApiException
                || failure instanceof com.youngminkim.recanet.PrivyAuthenticationException
                || failure instanceof com.youngminkim.recanet.TransactionQueryException)
            message = extract(failure.getMessage());
        // Unknown exceptions can contain arbitrary application data; use a fixed explanation.
        if (message == null || message.isBlank()) return fallback;
        String result = PEM.matcher(message).replaceAll("[REDACTED]");
        result = URL.matcher(result).replaceAll("[URL REDACTED]");
        result = AUTH.matcher(result).replaceAll("[AUTH REDACTED]");
        result = JWT.matcher(result).replaceAll("[JWT REDACTED]");
        result = SENSITIVE.matcher(result).replaceAll("[REDACTED]");
        result = HEX.matcher(result).replaceAll("[HEX REDACTED]");
        result = OPAQUE.matcher(result).replaceAll("[REDACTED]");
        result = result.replaceAll("[\\p{Cc}\\p{Cf}]+", " ").strip();
        return result.length() > 512 ? result.substring(0, 511) + "…" : result;
    }

    private static String extract(String value) {
        if (value == null || value.length() > MAX_INPUT) return null;
        String trimmed = value.strip();
        return trimmed.startsWith("{") || trimmed.startsWith("[") ? extractJson(trimmed) : trimmed;
    }

    private static String extractJson(String value) {
        if (value == null || value.length() > MAX_INPUT) return null;
        try {
            JsonNode root = JSON.readTree(value);
            if (root == null || !root.isObject()) return null;
            for (JsonNode node : new JsonNode[]{root.path("error").path("message"), root.path("message"), root.path("error")}) {
                if (node.isTextual()) {
                    String text = node.asText().strip();
                    if (!text.startsWith("{") && !text.startsWith("[")) return text;
                }
            }
        } catch (Exception ignored) { }
        return null;
    }
}
