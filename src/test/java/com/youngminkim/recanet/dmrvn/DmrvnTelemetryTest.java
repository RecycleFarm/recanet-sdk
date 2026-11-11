package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor;
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DmrvnTelemetryTest {
    @Test void storageFailureNamesCreateStepAndDoesNotSendRelayTransaction() throws Exception {
        var fixture = new DmrvnActivityTest();
        fixture.setup();
        var exporter = InMemoryLogRecordExporter.create();
        var spans = io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter.create();
        var failure = new UpstreamException(UpstreamException.Source.GREENFIELD, 403, 403,
                "Storage permission denied; token=secret-storage-token", "secret-response");
        var storage = new TestSupport.Storage() {
            @Override public String create(Map<String, Object> location, byte[] data) { throw failure; }
        };
        try (var otel = OpenTelemetrySdk.builder()
                .setLoggerProvider(SdkLoggerProvider.builder().addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build())
                .setTracerProvider(io.opentelemetry.sdk.trace.SdkTracerProvider.builder()
                        .addSpanProcessor(io.opentelemetry.sdk.trace.export.SimpleSpanProcessor.create(spans)).build()).build()) {
            var telemetry = SdkTelemetry.builder().openTelemetry(otel).localLogging(false).build();
            var client = new DmrvnClient(fixture.rpc.config, fixture.rpc, fixture.operator,
                    storage, fixture.methodology, null, telemetry);
            assertSame(failure, assertThrows(UpstreamException.class,
                    () -> client.submitActivity(fixture.wallets, fixture.request(Map.of()))));
            var logs = exporter.getFinishedLogRecordItems();
            var failed = logs.get(logs.size() - 1);
            assertEquals("GreenfieldStorage.create", failed.getAttributes().get(AttributeKey.stringKey("recanet.failed_stage")));
            assertEquals("EVIDENCE_SIGNED", failed.getAttributes().get(AttributeKey.stringKey("recanet.last_confirmed_state")));
            assertEquals("OUTCOME_UNKNOWN", failed.getAttributes().get(AttributeKey.stringKey("recanet.submission_state")));
            assertEquals(403L, failed.getAttributes().get(AttributeKey.longKey("http.response.status_code")));
            assertEquals(0, fixture.operator.sends);
            assertTrue(spans.getFinishedSpanItems().isEmpty());
            assertFalse(logs.toString().contains("secret"));
        }
    }

    @Test void oneCallAndItsStagesKeepSameOperationIdAndConfiguredExporter() throws Exception {
        var fixture = new DmrvnActivityTest();
        fixture.setup();
        var exporter = InMemoryLogRecordExporter.create();
        var spans = io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter.create();
        try (var otel = OpenTelemetrySdk.builder().setLoggerProvider(SdkLoggerProvider.builder()
                .addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build())
                .setTracerProvider(io.opentelemetry.sdk.trace.SdkTracerProvider.builder()
                        .addSpanProcessor(io.opentelemetry.sdk.trace.export.SimpleSpanProcessor.create(spans)).build()).build()) {
            var telemetry = SdkTelemetry.builder().openTelemetry(otel).localLogging(false)
                    .partnerId("partner-a").build();
            var client = new DmrvnClient(fixture.rpc.config, fixture.rpc, fixture.operator,
                    fixture.storage, fixture.methodology, null, telemetry);
            var result = client.submitActivity(fixture.wallets,
                    fixture.request(Map.of("private-input", "secret-evidence")));
            String operationId = (String) Json.map(result.get("confirmed")).get("operationId");
            var logs = exporter.getFinishedLogRecordItems();
            assertTrue(logs.size() > 4, "nested stage operations must use the same telemetry instance");
            String root = logs.get(0).getAttributes().get(AttributeKey.stringKey("recanet.root_call_id"));
            for (var log : logs) {
                assertEquals(operationId, log.getAttributes().get(AttributeKey.stringKey("recanet.operation_id")));
                assertEquals(root, log.getAttributes().get(AttributeKey.stringKey("recanet.root_call_id")));
                assertEquals("partner-a", log.getAttributes().get(AttributeKey.stringKey("recanet.partner_id")));
            }
            assertFalse(logs.toString().contains("secret-evidence"));
            assertFalse(logs.toString().contains("private-input"));
            assertEquals(1, fixture.operator.sends);
            assertTrue(spans.getFinishedSpanItems().isEmpty());
            for (String stage : java.util.List.of("GreenfieldStorage.create", "GreenfieldStorage.upload",
                    "EvmSigner.signMessage", "EvmSigner.signTypedData", "EvmSigner.sendTransaction", "EvmRpc.eth_call"))
                assertTrue(logs.stream().anyMatch(l -> stage.equals(l.getAttributes().get(AttributeKey.stringKey("recanet.stage")))));
            var last = logs.get(logs.size() - 1);
            assertEquals("SUBMISSION_CONFIRMED", last.getAttributes().get(AttributeKey.stringKey("recanet.last_confirmed_state")));
            assertEquals("CONFIRMED", last.getAttributes().get(AttributeKey.stringKey("recanet.submission_state")));
        }
    }

    @Test void unresolvedSubmissionIsAnErrorLogAndStillSendsExactlyOnce() throws Exception {
        var fixture = new DmrvnActivityTest();
        fixture.setup();
        fixture.confirm = false;
        var exporter = InMemoryLogRecordExporter.create();
        try (var otel = OpenTelemetrySdk.builder().setLoggerProvider(SdkLoggerProvider.builder()
                .addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build()).build()) {
            var telemetry = SdkTelemetry.builder().openTelemetry(otel).localLogging(false).build();
            var client = new DmrvnClient(fixture.rpc.config, fixture.rpc, fixture.operator,
                    fixture.storage, fixture.methodology, null, telemetry);
            var failure = assertThrows(DmrvnException.class,
                    () -> client.submitActivity(fixture.wallets, fixture.request(Map.of())));
            assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED, failure.code());
            assertEquals(1, fixture.operator.sends);
            var logs = exporter.getFinishedLogRecordItems();
            var last = logs.get(logs.size() - 1);
            assertEquals("failed", last.getAttributes().get(AttributeKey.stringKey("recanet.phase")));
            assertEquals("SUBMISSION_UNRESOLVED", last.getAttributes().get(AttributeKey.stringKey("error.code")));
        }
    }
}
