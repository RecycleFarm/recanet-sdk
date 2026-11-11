package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.youngminkim.recanet.dmrvn.DmrvnException;
import com.youngminkim.recanet.dmrvn.EvmSigner;
import com.youngminkim.recanet.dmrvn.UpstreamException;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.data.LogRecordData;
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor;
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class SdkTelemetryTest {
    static final class Capture implements AutoCloseable {
        final InMemoryLogRecordExporter exporter = InMemoryLogRecordExporter.create();
        final SdkLoggerProvider provider = SdkLoggerProvider.builder()
                .addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build();
        final OpenTelemetrySdk otel = OpenTelemetrySdk.builder().setLoggerProvider(provider).build();
        final SdkTelemetry telemetry = SdkTelemetry.builder().openTelemetry(otel)
                .localLogging(false).partnerId("partner-a").environment("test").build();
        List<LogRecordData> logs() { return exporter.getFinishedLogRecordItems(); }
        @Override public void close() { otel.close(); }
    }

    static String attribute(LogRecordData log, String key) {
        return log.getAttributes().get(AttributeKey.stringKey(key));
    }

    @Test void nestedCallsShareWorkflowAndActiveTraceAndRestoreContext() {
        try (var capture = new Capture()) {
            var span = SpanContext.create("12345678901234567890123456789012", "1234567890123456",
                    TraceFlags.getSampled(), TraceState.getDefault());
            try (var scope = Span.wrap(span).makeCurrent()) {
                assertEquals("BROADCAST", capture.telemetry.observe("Test.outer", "operation-1",
                        () -> capture.telemetry.observe("Test.inner", null, () -> "BROADCAST")));
            }
            capture.telemetry.observe("Test.separate", null, () -> true);
            var logs = capture.logs();
            assertEquals(6, logs.size());
            String root = attribute(logs.get(0), "recanet.call_id");
            for (var log : logs.subList(0, 4)) {
                assertEquals(root, attribute(log, "recanet.root_call_id"));
                assertEquals("operation-1", attribute(log, "recanet.operation_id"));
                assertEquals("partner-a", attribute(log, "recanet.partner_id"));
                assertEquals(span, log.getSpanContext());
            }
            assertEquals(root, attribute(logs.get(1), "recanet.parent_call_id"));
            assertEquals("completed", attribute(logs.get(3), "recanet.phase"));
            assertTrue(logs.get(3).getAttributes().get(AttributeKey.doubleKey("recanet.duration_ms")) >= 0);
            assertNotNull(attribute(logs.get(4), "recanet.operation_id"));
            assertNotEquals("operation-1", attribute(logs.get(4), "recanet.operation_id"));
            assertNull(attribute(logs.get(4), "recanet.parent_call_id"));
            assertNotEquals(root, attribute(logs.get(4), "recanet.root_call_id"));
        }
    }

    @Test void failureKeepsOriginalExceptionAndOmitsUpstreamSecretsAndInvalidIds() {
        try (var capture = new Capture()) {
            var original = new UpstreamException(UpstreamException.Source.EVM_RPC,
                    "secret-code", 503, "Bearer secret-token", "PRIVATE KEY secret-body");
            original.initCause(new IllegalStateException("secret-cause"));
            assertSame(original, assertThrows(UpstreamException.class, () ->
                    capture.telemetry.observe("Test.request", "injected\nsecret-id", () -> { throw original; })));
            var failed = capture.logs().get(1);
            assertEquals("failed", attribute(failed, "recanet.phase"));
            assertEquals(503L, failed.getAttributes().get(AttributeKey.longKey("http.response.status_code")));
            assertNotNull(attribute(failed, "recanet.operation_id"));
            assertFalse(attribute(failed, "recanet.operation_id").contains("injected"));
            assertEquals("EVM_RPC", attribute(failed, "recanet.upstream"));
            assertFalse(failed.toString().contains("secret"));
            capture.telemetry.observe("Test.next", null, () -> true);
            assertNull(attribute(capture.logs().get(2), "recanet.parent_call_id"));
        }
    }

    @Test void parallelCallsDoNotShareWorkflowIds() throws Exception {
        try (var capture = new Capture()) {
            var executor = Executors.newFixedThreadPool(2);
            var barrier = new java.util.concurrent.CyclicBarrier(2);
            try {
                var futures = new ArrayList<java.util.concurrent.Future<?>>();
                for (String id : List.of("operation-a", "operation-b")) {
                    futures.add(executor.submit(() -> capture.telemetry.observe("Test.parallel", id, () -> {
                        try { barrier.await(5, java.util.concurrent.TimeUnit.SECONDS); }
                        catch (Exception e) { throw new AssertionError(e); }
                        return capture.telemetry.observe("Test.child", null, () -> id);
                    })));
                }
                for (var future : futures) future.get(10, java.util.concurrent.TimeUnit.SECONDS);
            } finally { executor.shutdownNow(); }
            assertEquals(8, capture.logs().size());
            var roots = new java.util.HashMap<String, String>();
            for (var log : capture.logs()) {
                String id = attribute(log, "recanet.operation_id");
                String root = attribute(log, "recanet.root_call_id");
                String existing = roots.putIfAbsent(id, root);
                if (existing != null) assertEquals(existing, root);
            }
            assertEquals(2, roots.size());
            assertNotEquals(roots.get("operation-a"), roots.get("operation-b"));
        }
    }

    @Test void localJsonIsParseableAndBrokenHandlerDoesNotPreventOtelOrBusinessCalls() throws Exception {
        var logger = Logger.getLogger(SdkTelemetry.LOGGER_NAME);
        boolean parents = logger.getUseParentHandlers();
        Level oldLevel = logger.getLevel();
        var messages = new ArrayList<String>();
        Handler handler = new Handler() {
            @Override public void publish(LogRecord record) { messages.add(record.getMessage()); }
            @Override public void flush() {}
            @Override public void close() {}
        };
        try (var capture = new Capture()) {
            logger.setUseParentHandlers(false);
            logger.setLevel(Level.ALL);
            logger.addHandler(handler);
            var telemetry = SdkTelemetry.builder().openTelemetry(capture.otel).build();
            telemetry.observe("Test.json", "operation-1", () -> "secret-result");
            assertEquals(2, messages.size());
            assertEquals("completed", new ObjectMapper().readTree(messages.get(1)).get("recanet.phase").asText());
            assertFalse(messages.toString().contains("secret-result"));
            logger.removeHandler(handler);
            Handler broken = new Handler() {
                @Override public void publish(LogRecord record) { throw new IllegalStateException("broken handler"); }
                @Override public void flush() {}
                @Override public void close() {}
            };
            logger.addHandler(broken);
            try {
                assertEquals("ok", telemetry.observe("Test.handler", null, () -> "ok"));
                var failure = new DmrvnException(DmrvnException.Code.INTERRUPTED);
                Thread.currentThread().interrupt();
                try {
                    assertSame(failure, assertThrows(DmrvnException.class, () ->
                            telemetry.observe("Test.interrupted", null, () -> { throw failure; })));
                    assertTrue(Thread.currentThread().isInterrupted());
                } finally { Thread.interrupted(); }
            } finally { logger.removeHandler(broken); }
            assertEquals(6, capture.logs().size());
        } finally {
            logger.removeHandler(handler);
            logger.setUseParentHandlers(parents);
            logger.setLevel(oldLevel);
        }
    }

    @Test void transferLogsUnresolvedOutcomeWithoutRetryOrSensitiveArguments() {
        try (var capture = new Capture()) {
            var client = new AssetClient((method, params) ->
                    method.equals("eth_chainId") ? "0x66eee" : "0x1", capture.telemetry);
            AtomicInteger sends = new AtomicInteger();
            EvmSigner signer = new EvmSigner() {
                public String address() { return "0x" + "12".repeat(20); }
                public String signMessage(String message) { throw new AssertionError(); }
                public String signTypedData(Map<String, Object> data) { throw new AssertionError(); }
                public String sendTransaction(long chainId, Map<String, Object> tx, String id) {
                    sends.incrementAndGet();
                    return "invalid-hash-secret";
                }
            };
            var error = assertThrows(DmrvnException.class, () -> client.transfer(signer,
                    "0x" + "34".repeat(20), BigInteger.ONE, "transfer-1"));
            assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED, error.code());
            assertEquals(1, sends.get());
            var failed = capture.logs().get(capture.logs().size() - 1);
            assertEquals("AssetClient.submitTransaction", attribute(failed, "recanet.failed_stage"));
            assertEquals("OUTCOME_UNKNOWN", attribute(failed, "recanet.submission_state"));
            assertEquals("CHAIN_VERIFIED", attribute(failed, "recanet.last_confirmed_state"));
            assertEquals("AssetClient.transfer", attribute(failed, "recanet.operation"));
            assertEquals("SUBMISSION_UNRESOLVED", attribute(failed, "error.code"));
            assertEquals("transfer-1", attribute(failed, "recanet.operation_id"));
            assertFalse(capture.logs().toString().contains("invalid-hash-secret"));
            assertFalse(capture.logs().toString().contains(signer.address()));
        }
    }

    @Test void privyClientEmitsSafeHttpFailureAndConfigCopiesPreserveTelemetry() throws Exception {
        try (var capture = new Capture()) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            var requests = new AtomicInteger();
            server.createContext("/", exchange -> {
                requests.incrementAndGet();
                byte[] body = "{\"error\":\"Permission denied\",\"authorization\":\"Bearer secret-body\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(401, body.length);
                try (var out = exchange.getResponseBody()) { out.write(body); }
            });
            server.start();
            try {
                var verification = PrivyTokenVerificationConfig.usingJwks(URI.create("https://example.com/jwks"));
                var config = new PrivyClientConfig("app", "secret-credential",
                        URI.create("http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(3))
                        .withTelemetry(capture.telemetry).withTokenVerification(verification);
                assertSame(capture.telemetry, config.telemetry());
                assertSame(verification, config.withTelemetry(SdkTelemetry.disabled()).tokenVerification());
                var error = assertThrows(io.privy.api.models.errors.APIException.class,
                        () -> new PrivyClient(config).verifyAppCredentials());
                assertEquals(401, error.code());
                assertEquals(1, requests.get());
                assertEquals(2, capture.logs().size());
                assertEquals(401L, capture.logs().get(1).getAttributes()
                        .get(AttributeKey.longKey("http.response.status_code")));
                assertFalse(capture.logs().toString().contains("secret"));
            } finally { server.stop(0); }
        }
    }
}
