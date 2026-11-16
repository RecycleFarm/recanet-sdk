package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;
import com.youngminkim.recanet.dmrvn.*;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.data.LogRecordData;
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor;
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import java.math.BigInteger;
import java.util.*;
import org.junit.jupiter.api.Test;

class SdkLogWorkflowTest {
    @Test void standaloneTokenVerifierLogsFailureWithoutTokenContents() {
        try (var c = new Capture()) {
            var verifier = new PrivyTokenVerifier("app", PrivyTokenVerificationConfig.usingJwks(
                    java.net.URI.create("https://keys.example/jwks")), c.telemetry);
            assertThrows(PrivyAuthenticationException.class,
                    () -> verifier.authenticateAuthorizationHeader("Bearer sensitive-test-token"));
            assertEquals("PrivyTokenVerifier.verifyAccessToken", attr(c.last(), "recanet.failed_stage"));
            assertEquals("INVALID_TOKEN", attr(c.last(), "error.code"));
            assertFalse(c.logs.getFinishedLogRecordItems().toString().contains("sensitive-test-token"));
            assertTrue(c.spans.getFinishedSpanItems().isEmpty());
        }
    }

    @Test void standaloneRpcLogsOriginalSafeMessageButNoEndpointOrParameters() throws Exception {
        try (var c = new Capture()) {
            var count = new java.util.concurrent.atomic.AtomicInteger();
            var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                count.incrementAndGet();
                exchange.getRequestBody().readAllBytes();
                byte[] body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32000,\"message\":\"execution reverted: insufficient funds\"}}"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, body.length);
                try (var output = exchange.getResponseBody()) { output.write(body); }
            });
            server.start();
            try {
                var rpc = new HttpEvmRpc(java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort()
                        + "/?apiKey=endpoint-secret"), c.telemetry);
                assertThrows(UpstreamException.class, () -> rpc.call("eth_estimateGas", List.of("parameter-secret")));
                assertEquals(1, count.get());
                assertEquals("EvmRpc.eth_estimateGas", attr(c.last(), "recanet.failed_stage"));
                assertEquals("-32000", attr(c.last(), "error.code"));
                assertEquals("execution reverted: insufficient funds", attr(c.last(), "error.message"));
                assertNotNull(attr(c.last(), "recanet.operation_id"));
                assertFalse(c.logs.getFinishedLogRecordItems().toString().contains("secret"));
                assertTrue(c.spans.getFinishedSpanItems().isEmpty());
            } finally { server.stop(0); }
        }
    }

    @Test void walletCreationFailureIncludesLookupStateNativeCodeAndMessageWithNoSpans() throws Exception {
        try (var c = new Capture()) {
            var requests = new ArrayList<String>();
            var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/v1/wallets", exchange -> {
                requests.add(exchange.getRequestMethod());
                exchange.getRequestBody().readAllBytes();
                boolean lookup = exchange.getRequestMethod().equals("GET");
                byte[] body = (lookup ? "{\"data\":[]}" :
                        "{\"code\":\"permission_denied\",\"error\":\"Wallet creation permission denied\",\"token\":\"body-secret\"}")
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(lookup ? 200 : 403, body.length);
                try (var output = exchange.getResponseBody()) { output.write(body); }
            });
            server.start();
            try {
                var config = new PrivyClientConfig("demo-app", "credential-secret",
                        java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort()), java.time.Duration.ofSeconds(3))
                        .withTelemetry(c.telemetry);
                var wallets = new UserWalletClient(new PrivyClient(config), BackendWalletKeyPair.generate().registration(), "test");
                var failure = assertThrows(io.privy.api.models.errors.APIException.class,
                        () -> c.telemetry.observe("Test.wallet", "wallet-test", () -> wallets.getOrCreateWallet("member-secret")));
                assertEquals(403, failure.code());
                assertEquals(List.of("GET", "POST"), requests);
                assertEquals("PrivyClient.registerBackendWallet", attr(c.last(), "recanet.failed_stage"));
                assertEquals("WALLET_NOT_FOUND", attr(c.last(), "recanet.last_confirmed_state"));
                assertEquals("REJECTED", attr(c.last(), "recanet.submission_state"));
                assertEquals("permission_denied", attr(c.last(), "error.code"));
                assertEquals("Wallet creation permission denied", attr(c.last(), "error.message"));
                for (var log : c.logs.getFinishedLogRecordItems()) assertEquals("wallet-test", attr(log, "recanet.operation_id"));
                assertFalse(c.logs.getFinishedLogRecordItems().toString().contains("secret"));
                assertTrue(c.spans.getFinishedSpanItems().isEmpty());
            } finally { server.stop(0); }
        }
    }

    static final class Capture implements AutoCloseable {
        final InMemoryLogRecordExporter logs = InMemoryLogRecordExporter.create();
        final InMemorySpanExporter spans = InMemorySpanExporter.create();
        final OpenTelemetrySdk otel = OpenTelemetrySdk.builder()
                .setLoggerProvider(SdkLoggerProvider.builder().addLogRecordProcessor(SimpleLogRecordProcessor.create(logs)).build())
                .setTracerProvider(SdkTracerProvider.builder().addSpanProcessor(SimpleSpanProcessor.create(spans)).build()).build();
        final SdkTelemetry telemetry = SdkTelemetry.builder().openTelemetry(otel).localLogging(false).partnerId("partner-a").build();
        LogRecordData last() { var records = logs.getFinishedLogRecordItems(); return records.get(records.size() - 1); }
        @Override public void close() { otel.close(); }
    }
    static String attr(LogRecordData log, String key) { return log.getAttributes().get(AttributeKey.stringKey(key)); }

    @Test void createsNoSpansEvenWithRealTracerAndLegacyTracingTrue() {
        try (var c = new Capture()) {
            var telemetry = SdkTelemetry.builder().openTelemetry(c.otel).localLogging(false).tracing(true).build();
            var parent = c.otel.getTracer("application").spanBuilder("request").startSpan();
            try (var ignored = parent.makeCurrent()) {
                telemetry.observe("Test.outer", "operation-a", () -> telemetry.step("Test.inner", () -> "ok"));
                assertEquals(parent.getSpanContext(), Span.current().getSpanContext());
            } finally { parent.end(); }
            assertEquals(1, c.spans.getFinishedSpanItems().size());
            assertEquals("request", c.spans.getFinishedSpanItems().get(0).getName());
            assertEquals(1, c.logs.getFinishedLogRecordItems().size());
            for (var log : c.logs.getFinishedLogRecordItems()) {
                assertEquals("operation-a", attr(log, "recanet.operation_id"));
                assertEquals(parent.getSpanContext(), log.getSpanContext());
            }
            c.telemetry.observe("Test.standalone", null, () -> true);
            assertFalse(c.last().getSpanContext().isValid());
            assertNotNull(attr(c.last(), "recanet.operation_id"));
        }
    }

    @Test void failedRpcReportsLeafStageLastConfirmedStateAndOriginalMessageWithoutRetry() {
        try (var c = new Capture()) {
            var calls = new ArrayList<String>();
            var failure = new UpstreamException(UpstreamException.Source.EVM_RPC, -32602, 200,
                    "Invalid gas parameters; token=secret-token", "secret-response");
            var client = new AssetClient((method, params) -> {
                calls.add(method);
                if (method.equals("eth_chainId")) return "0x66eee";
                throw failure;
            }, c.telemetry);
            var signer = new EvmSigner() {
                public String address() { return "0x" + "12".repeat(20); }
                public String signMessage(String m) { throw new AssertionError(); }
                public String signTypedData(Map<String,Object> d) { throw new AssertionError(); }
                public String sendTransaction(long chain, Map<String,Object> tx, String key) { throw new AssertionError(); }
            };
            assertSame(failure, assertThrows(UpstreamException.class, () -> client.transfer(signer,
                    "0x" + "34".repeat(20), BigInteger.ONE, "transfer-a")));
            var failed = c.last();
            assertEquals(List.of("eth_chainId", "eth_estimateGas"), calls);
            assertEquals("EvmRpc.eth_estimateGas", attr(failed, "recanet.failed_stage"));
            assertEquals("CHAIN_VERIFIED", attr(failed, "recanet.last_confirmed_state"));
            assertEquals("NOT_ATTEMPTED", attr(failed, "recanet.submission_state"));
            assertEquals("-32602", attr(failed, "error.code"));
            assertTrue(attr(failed, "error.message").contains("Invalid gas parameters"));
            assertFalse(c.logs.getFinishedLogRecordItems().toString().contains("secret"));
            assertTrue(c.spans.getFinishedSpanItems().isEmpty());
        }
    }

    @Test void sanitizesAuthenticationUrlsPemHexAndControlCharactersWhilePreservingUsefulText() {
        try (var c = new Capture()) {
            var failure = new UpstreamException(UpstreamException.Source.GREENFIELD, "ACCESS_DENIED", 403,
                    "Permission denied\nBearer abc-secret; private_key=short-secret; "
                    + "https://host.example/api?token=url-secret 0x" + "ab".repeat(32)
                    + " -----BEGIN PRIVATE KEY-----pem-secret-----END PRIVATE KEY-----", "response-secret");
            assertSame(failure, assertThrows(UpstreamException.class,
                    () -> c.telemetry.observe("Test.request", "operation-a", () -> { throw failure; })));
            String message = attr(c.last(), "error.message");
            assertTrue(message.startsWith("Permission denied"));
            for (String secret : List.of("abc-secret", "short-secret", "url-secret", "pem-secret", "response-secret", "ab".repeat(32)))
                assertFalse(message.contains(secret), secret);
            assertFalse(message.contains("\n"));
            assertEquals("ACCESS_DENIED", attr(c.last(), "error.code"));
        }
    }

    @Test void handledErrorIsFailureLogWithoutChangingResultOrInventingCompletedState() {
        try (var c = new Capture()) {
            var value = Map.of("reportError", "REPORT_MISMATCH");
            assertSame(value, c.telemetry.observe("Test.outerReader", null, () -> c.telemetry.observe("Test.reader", null, () -> {
                c.telemetry.checkpoint(SdkTelemetry.State.REPORT_READ);
                c.telemetry.recordHandledFailure(new DmrvnException(DmrvnException.Code.REPORT_MISMATCH));
                return value;
            })));
            assertEquals("failed", attr(c.last(), "recanet.phase"));
            assertEquals("Test.reader", attr(c.last(), "recanet.failed_stage"));
            assertEquals("REPORT_READ", attr(c.last(), "recanet.last_confirmed_state"));
            assertEquals(true, c.last().getAttributes().get(AttributeKey.booleanKey("recanet.failure_handled")));
            assertFalse(c.logs.getFinishedLogRecordItems().stream().anyMatch(l -> "completed".equals(attr(l,"recanet.phase"))));
        }
    }

    @Test void duplicateBoundaryFailureRunsBusinessActionExactlyOnce() {
        try (var c = new Capture()) {
            var calls = new java.util.concurrent.atomic.AtomicInteger();
            var failure = new DmrvnException(DmrvnException.Code.SUBMISSION_UNRESOLVED);
            assertSame(failure, assertThrows(DmrvnException.class, () -> c.telemetry.step("Test.same", () ->
                    c.telemetry.step("Test.same", () -> { calls.incrementAndGet(); throw failure; }))));
            assertEquals(1, calls.get());
            assertEquals(1, c.logs.getFinishedLogRecordItems().size());
            c.telemetry.observe("Test.next", null, () -> true);
            assertNull(attr(c.last(), "recanet.parent_call_id"));
            assertNull(attr(c.last(), "recanet.submission_state"));
            assertEquals("STEP_COMPLETED", attr(c.last(), "recanet.last_confirmed_state"));
        }
    }

    @Test void oversizedAndUnstructuredExceptionMessagesUseSafeFallback() {
        try (var c = new Capture()) {
            var failure = new UpstreamException(UpstreamException.Source.EVM_RPC, null, 500, "s".repeat(20_000), null);
            assertThrows(UpstreamException.class, () -> c.telemetry.observe("Test.large", null, () -> { throw failure; }));
            assertTrue(attr(c.last(), "error.message").length() <= 512);
            var unknown = new IllegalStateException("arbitrary-application-secret");
            assertThrows(IllegalStateException.class, () -> c.telemetry.observe("Test.unknown", null, () -> { throw unknown; }));
            assertFalse(attr(c.last(), "error.message").contains("arbitrary"));
        }
    }
}
