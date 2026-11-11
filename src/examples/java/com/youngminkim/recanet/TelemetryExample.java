package com.youngminkim.recanet;

import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk;
import java.util.Map;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import com.sun.net.httpserver.HttpServer;

/** Wallet provisioning logs against a loopback fixture; never creates a real wallet. */
public final class TelemetryExample {
    public static void main(String[] args) throws Exception {
        String common = System.getenv("OTEL_EXPORTER_OTLP_ENDPOINT");
        boolean hasCommon = common != null && !common.isBlank();
        if (hasCommon) validateEndpoint(common);
        for (String setting : new String[]{"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"}) {
            String endpoint = System.getenv(setting);
            if (endpoint != null && !endpoint.isBlank()) validateEndpoint(endpoint);
            else if (!hasCommon) throw new IllegalArgumentException("Set OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_LOGS_ENDPOINT");
        }
        // No setResultAsGlobal(): this provider is private to Recanet logs.
        try (var otel = AutoConfiguredOpenTelemetrySdk.builder()
                .addPropertiesSupplier(() -> Map.ofEntries(
                        Map.entry("otel.service.name", "recanet-sdk"),
                        Map.entry("otel.resource.attributes", "service.namespace=" + required("RECANET_PARTNER_ID")),
                        Map.entry("otel.traces.exporter", "none"),
                        Map.entry("otel.metrics.exporter", "none"),
                        Map.entry("otel.logs.exporter", "otlp"),
                        Map.entry("otel.exporter.otlp.protocol", "http/protobuf"),
                        Map.entry("otel.blrp.max.queue.size", "2048"),
                        Map.entry("otel.blrp.max.export.batch.size", "256"),
                        Map.entry("otel.blrp.export.timeout", "5000"),
                        Map.entry("otel.bsp.max.queue.size", "2048"),
                        Map.entry("otel.bsp.max.export.batch.size", "256"),
                        Map.entry("otel.bsp.export.timeout", "5000")))
                .addPropertiesCustomizer(config -> Map.of("otel.traces.exporter", "none", "otel.metrics.exporter", "none"))
                .build().getOpenTelemetrySdk()) {
            var telemetry = SdkTelemetry.builder().openTelemetry(otel)
                    .partnerId(required("RECANET_PARTNER_ID"))
                    .environment(required("RECANET_ENVIRONMENT")).build();
            walletCreationFailure(telemetry);
            var logs = otel.getSdkLoggerProvider().forceFlush();
            boolean logsDone = logs.join(10, java.util.concurrent.TimeUnit.SECONDS).isSuccess();
            if (!logsDone)
                throw new IllegalStateException("Telemetry flush did not complete; inspect exporter diagnostics");
        }
    }

    private static void walletCreationFailure(SdkTelemetry telemetry) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var requests = new java.util.ArrayList<String>();
        server.createContext("/v1/wallets", exchange -> {
            String method = exchange.getRequestMethod();
            requests.add(method);
            exchange.getRequestBody().readAllBytes();
            // Lookup succeeds with no existing wallet; the final create request is denied.
            byte[] body = ("GET".equals(method) ? "{\"data\":[]}"
                    : "{\"error\":\"Synthetic wallet creation permission denied\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders("GET".equals(method) ? 200 : 403, body.length);
            try (var out = exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        try {
            var config = new PrivyClientConfig("demo-app", "demo-secret",
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(5))
                    .withTelemetry(telemetry);
            var wallets = new UserWalletClient(new PrivyClient(config),
                    BackendWalletKeyPair.generate().registration(), "telemetry-demo");
            try {
                telemetry.observe("WalletCreationDemo.provision", "wallet-create-demo", () -> {
                    return wallets.getOrCreateWallet("demo-member");
                });
                throw new IllegalStateException("Expected wallet creation to fail");
            } catch (io.privy.api.models.errors.APIException expected) {
                if (expected.code() != 403 || !requests.equals(java.util.List.of("GET", "POST")))
                    throw new IllegalStateException("Unexpected wallet demo failure", expected);
                System.out.println("Mock wallet lookup succeeded; final wallet creation failed (HTTP 403). No real wallet was created.");
            }
        } finally {
            server.stop(0);
        }
    }

    private static void validateEndpoint(String endpoint) {
        var uri = java.net.URI.create(endpoint);
        boolean loopback = "localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost())
                || "[::1]".equals(uri.getHost());
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                || uri.getFragment() != null || !("https".equals(uri.getScheme())
                || ("http".equals(uri.getScheme()) && loopback)))
            throw new IllegalArgumentException("OTLP endpoints must use HTTPS, or HTTP on loopback, without credentials/query/fragment");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Set " + name);
        return value;
    }
}
