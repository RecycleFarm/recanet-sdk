package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;
import com.youngminkim.recanet.UserWalletClient;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.logs.SdkLoggerProvider;
import io.opentelemetry.sdk.logs.export.SimpleLogRecordProcessor;
import io.opentelemetry.sdk.testing.exporter.InMemoryLogRecordExporter;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

class DmrvnOperationalLoggingPolicyTest {
    record Operation(String label, String root, BiConsumer<DmrvnClient,DmrvnReader> action) {}
    @TestFactory Stream<DynamicTest> everyStepApiUsesCompactErrorsWhenCalledIndependently() {
        var operations = List.of(
                new Operation("prepareEvidence", "DmrvnClient.prepareEvidence", (c,r) -> c.prepareEvidence("invalid id", "", "", "", Map.of())),
                new Operation("recoverCreateTransaction", "DmrvnClient.recoverCreateTransaction", (c,r) -> c.recoverCreateTransaction("missing", "invalid")),
                new Operation("approveClaim", "DmrvnClient.approveClaim", (c,r) -> c.approveClaim("missing")),
                new Operation("prepare", "DmrvnClient.prepare", (c,r) -> c.prepare("invalid id", "", "", "", Map.of())),
                new Operation("submitActivity.walletProvider", "DmrvnClient.submitActivity", (c,r) -> c.submitActivity((BeneficiaryWallets)null, null)),
                new Operation("submitActivity.userWallet", "DmrvnClient.submitActivity", (c,r) -> c.submitActivity((UserWalletClient)null, "", "missing", "", "", Map.of(), "1")),
                new Operation("submitActivity.signer", "DmrvnClient.submitActivity", (c,r) -> c.submitActivity((EvmSigner)null, "missing", "", "", Map.of(), "1")),
                new Operation("prepareSponsored", "DmrvnClient.prepareSponsored", (c,r) -> c.prepareSponsored("missing", "1")),
                new Operation("prepareSelfPaid", "DmrvnClient.prepareSelfPaid", (c,r) -> c.prepareSelfPaid("missing")),
                new Operation("recordSponsoredSignature", "DmrvnClient.recordSponsoredSignature", (c,r) -> c.recordSponsoredSignature("missing", Map.of(), "")),
                new Operation("submitSponsored", "DmrvnClient.submitSponsored", (c,r) -> c.submitSponsored("missing", Map.of(), "")),
                new Operation("resolveSubmission", "DmrvnClient.resolveSubmission", (c,r) -> c.resolveSubmission("missing", "invalid")),
                new Operation("operation", "DmrvnClient.operation", (c,r) -> c.operation("missing")),
                new Operation("readResult", "DmrvnClient.readResult", (c,r) -> c.readResult("missing", r, null, null, false)),
                new Operation("reader.readResult", "DmrvnReader.readResult", (c,r) -> r.readResult("invalid", null, null, false, null)),
                new Operation("reader.verifyEvidenceProvenance", "DmrvnReader.verifyEvidenceProvenance", (c,r) -> r.verifyEvidenceProvenance("invalid", new byte[0]))
        );
        return operations.stream().map(operation -> DynamicTest.dynamicTest(operation.label(), () -> {
            var fixture = new DmrvnActivityTest();
            fixture.setup();
            var exporter = InMemoryLogRecordExporter.create();
            try (var otel = OpenTelemetrySdk.builder().setLoggerProvider(SdkLoggerProvider.builder()
                    .addLogRecordProcessor(SimpleLogRecordProcessor.create(exporter)).build()).build()) {
                var telemetry = SdkTelemetry.builder().openTelemetry(otel).localLogging(false).build();
                var client = new DmrvnClient(fixture.rpc.config, fixture.rpc, fixture.operator, fixture.storage,
                        fixture.methodology, null, telemetry);
                var reader = new DmrvnReader(fixture.rpc.config, fixture.rpc, location -> new byte[0],
                        hash -> Map.of(), telemetry);
                assertThrows(RuntimeException.class, () -> operation.action().accept(client, reader));
                var logs = exporter.getFinishedLogRecordItems();
                assertEquals(1, logs.size(), "Standalone step failures must not expand into lifecycle logs");
                var fields = logs.get(0).getAttributes();
                assertEquals("failed", fields.get(AttributeKey.stringKey("recanet.phase")));
                assertEquals(operation.root(), fields.get(AttributeKey.stringKey("recanet.operation")));
                for (String field : List.of("recanet.operation_id", "recanet.failed_stage", "error.code", "error.message",
                        "recanet.last_confirmed_stage", "recanet.last_confirmed_state"))
                    assertNotNull(fields.get(AttributeKey.stringKey(field)), field);
                assertEquals(0, fixture.operator.sends);
                assertEquals(0, fixture.storage.creates);
            }
        }));
    }
}
