package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;
import com.youngminkim.recanet.dmrvn.DmrvnException;
import com.youngminkim.recanet.dmrvn.UpstreamException;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.sdk.logs.data.LogRecordData;
import java.util.*;
import org.junit.jupiter.api.Test;

class SdkCompactLoggingTest {
    @Test void concurrentSubmissionsKeepBothAcceptancesAndCorrectSequence() throws Exception {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
            var barrier = new java.util.concurrent.CyclicBarrier(2);
            try {
                c.telemetry.observe("Test.parallel", "parallel-work", () -> {
                    var context = io.opentelemetry.context.Context.current();
                    var futures = new ArrayList<java.util.concurrent.Future<?>>();
                    for (int i = 0; i < 2; i++) {
                        futures.add(executor.submit(context.wrap(() -> c.telemetry.step("EvmSigner.sendTransaction", () -> {
                            c.telemetry.submissionAttempt();
                            try { barrier.await(5, java.util.concurrent.TimeUnit.SECONDS); }
                            catch (Exception e) { throw new AssertionError(e); }
                            c.telemetry.submissionAccepted();
                            return true;
                        }))));
                    }
                    for (var future : futures) {
                        try { future.get(10, java.util.concurrent.TimeUnit.SECONDS); }
                        catch (Exception e) { throw new AssertionError(e); }
                    }
                    return true;
                });
            } finally { executor.shutdownNow(); }
            assertEquals(2, phase(c, "submission_started").size());
            assertEquals(2, phase(c, "submission_accepted").size());
            var started = phase(c, "submission_started").stream().map(l -> l.getAttributes()
                    .get(AttributeKey.longKey("recanet.submission_sequence"))).collect(java.util.stream.Collectors.toSet());
            var accepted = phase(c, "submission_accepted").stream().map(l -> l.getAttributes()
                    .get(AttributeKey.longKey("recanet.submission_sequence"))).collect(java.util.stream.Collectors.toSet());
            assertEquals(Set.of(1L, 2L), started);
            assertEquals(started, accepted);
            assertTrue(logs(c).stream().allMatch(l -> "parallel-work".equals(attr(l, "recanet.operation_id"))));
        }
    }

    @Test void differentNestedSideEffectsAreNotMistakenForWrapperDuplicates() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            c.telemetry.observe("Test.root", null, () -> c.telemetry.step("GreenfieldStorage.create", () -> {
                c.telemetry.submissionAttempt();
                c.telemetry.step("EvmSigner.sendTransaction", () -> {
                    c.telemetry.submissionAttempt(); c.telemetry.submissionAccepted(); return true;
                });
                c.telemetry.submissionAccepted();
                return true;
            }));
            assertEquals(2, phase(c, "submission_started").size());
            assertEquals(2, phase(c, "submission_accepted").size());
        }
    }

    static String attr(LogRecordData log, String key) { return SdkLogWorkflowTest.attr(log, key); }
    static List<LogRecordData> logs(SdkLogWorkflowTest.Capture c) { return c.logs.getFinishedLogRecordItems(); }
    static List<LogRecordData> phase(SdkLogWorkflowTest.Capture c, String phase) {
        return logs(c).stream().filter(l -> phase.equals(attr(l, "recanet.phase"))).toList();
    }

    @Test void balanceEmitsOneCompactSummaryAndStillValidatesBothRpcCalls() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var calls = new ArrayList<String>();
            var client = new AssetClient((method, params) -> {
                calls.add(method);
                return method.equals("eth_chainId") ? "0x66eee" : "0x2";
            }, c.telemetry);
            assertEquals(java.math.BigInteger.TWO, client.getBalance("0x" + "12".repeat(20)));
            assertEquals(List.of("eth_chainId", "eth_getBalance"), calls);
            assertEquals(1, logs(c).size());
            assertEquals("AssetClient.getBalance", attr(c.last(), "recanet.operation"));
            assertEquals("BALANCE_READ", attr(c.last(), "recanet.last_confirmed_state"));
            assertNotNull(attr(c.last(), "recanet.operation_id"));
            for (String redundant : List.of("recanet.call_id", "recanet.root_call_id", "recanet.parent_call_id",
                    "recanet.stage", "timestamp", "event.name", "recanet.submission_state"))
                assertNull(attr(c.last(), redundant), redundant);
            assertTrue(c.last().getTimestampEpochNanos() > 0);
        }
    }

    @Test void sameFailureIsLoggedOnceAtLeafWithRootOperationAndKnownState() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var failure = new DmrvnException(DmrvnException.Code.WRONG_CHAIN);
            assertSame(failure, assertThrows(DmrvnException.class, () -> c.telemetry.observe("Test.root", "work-a", () -> {
                c.telemetry.checkpoint(SdkTelemetry.State.WALLET_FOUND);
                return c.telemetry.step("Test.middle", () -> c.telemetry.step("Test.leaf", () -> { throw failure; }));
            })));
            assertEquals(1, logs(c).size());
            assertEquals("Test.root", attr(c.last(), "recanet.operation"));
            assertEquals("Test.leaf", attr(c.last(), "recanet.failed_stage"));
            assertEquals("WALLET_FOUND", attr(c.last(), "recanet.last_confirmed_state"));
            assertEquals("WRONG_CHAIN", attr(c.last(), "error.code"));
            assertNotNull(attr(c.last(), "error.message"));
        }
    }

    @Test void recoveredErrorsAndRepeatedUseOfSameExceptionInstanceAreNotLost() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var failure = new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
            c.telemetry.observe("Test.retry", "work-a", () -> {
                for (int i = 0; i < 2; i++) {
                    assertSame(failure, assertThrows(DmrvnException.class,
                            () -> c.telemetry.step("Test.rpc", () -> { throw failure; })));
                }
                return true;
            });
            assertEquals(2, phase(c, "failed").size());
            assertEquals(1, phase(c, "completed").size());
            assertTrue(logs(c).stream().allMatch(l -> "work-a".equals(attr(l, "recanet.operation_id"))));
        }
    }

    @Test void wrappedPropagationKeepsOriginalSafeCauseWithoutDuplicateError() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var original = new DmrvnException(DmrvnException.Code.STORAGE_UNAVAILABLE);
            var wrapped = assertThrows(IllegalStateException.class, () -> c.telemetry.observe("Test.root", null, () -> {
                try { return c.telemetry.step("Test.storage", () -> { throw original; }); }
                catch (DmrvnException e) { throw new IllegalStateException("wrapper-secret", e); }
            }));
            assertSame(original, wrapped.getCause());
            assertEquals(1, phase(c, "failed").size());
            assertEquals("STORAGE_UNAVAILABLE", attr(c.last(), "error.code"));
            assertEquals("Test.storage", attr(c.last(), "recanet.failed_stage"));
            assertFalse(logs(c).toString().contains("wrapper-secret"));
        }
    }

    @Test void nestedSubmissionMarkersRouteToRootSinkAndRemainVisibleBeforeSideEffect() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            c.telemetry.observe("Test.root", "work-a", () -> c.telemetry.step("EvmSigner.sendTransaction", () -> {
                c.telemetry.submissionAttempt();
                assertEquals(1, phase(c, "submission_started").size(), "intent must exist before the delegate runs");
                SdkTelemetry.local().step("PrivyEvmSigner.sendTransaction", () -> {
                    SdkTelemetry.local().submissionAttempt();
                    assertEquals(1, phase(c, "submission_started").size());
                    SdkTelemetry.local().submissionAccepted();
                    return true;
                });
                c.telemetry.submissionAccepted();
                c.telemetry.checkpoint(SdkTelemetry.State.SUBMITTED);
                return true;
            }));
            assertEquals(1, phase(c, "submission_started").size());
            assertEquals(1, phase(c, "submission_accepted").size());
            assertEquals(1, phase(c, "completed").size());
            assertEquals("SUBMITTED", attr(c.last(), "recanet.last_confirmed_state"));
            assertTrue(logs(c).stream().allMatch(l -> "partner-a".equals(attr(l, "recanet.partner_id"))));
        }
    }

    @Test void separateSubmissionsGetSeparateSequenceAndTimeoutStaysUnknown() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            var failure = new UpstreamException(UpstreamException.Source.EVM_RPC, null, 0, "timeout", null);
            failure.initCause(new java.net.http.HttpTimeoutException("transport-secret"));
            assertSame(failure, assertThrows(UpstreamException.class, () -> c.telemetry.observe("Test.root", "work-a", () -> {
                c.telemetry.step("Test.firstSubmit", () -> {
                    c.telemetry.submissionAttempt(); c.telemetry.submissionAccepted();
                    c.telemetry.checkpoint(SdkTelemetry.State.SUBMITTED); return true;
                });
                return c.telemetry.step("Test.secondSubmit", () -> { c.telemetry.submissionAttempt(); throw failure; });
            })));
            assertEquals(2, phase(c, "submission_started").size());
            assertEquals(1, phase(c, "submission_accepted").size());
            assertEquals(1, phase(c, "failed").size());
            assertEquals("Test.secondSubmit", attr(c.last(), "recanet.failed_stage"));
            assertEquals("SUBMITTED", attr(c.last(), "recanet.last_confirmed_state"));
            assertEquals("OUTCOME_UNKNOWN", attr(c.last(), "recanet.submission_state"));
            assertEquals(2L, c.last().getAttributes().get(AttributeKey.longKey("recanet.submission_sequence")));
        }
    }

    @Test void repeatedJournalCheckpointsEmitOnlyImportantStatesOnce() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            c.telemetry.observe("Test.root", null, () -> {
                for (int i = 0; i < 10; i++) {
                    c.telemetry.checkpoint(SdkTelemetry.State.APPROVED);
                    c.telemetry.step("Test.read", () -> true);
                }
                c.telemetry.checkpoint(SdkTelemetry.State.EVIDENCE_SEALED);
                c.telemetry.checkpoint(SdkTelemetry.State.EVIDENCE_SEALED);
                return true;
            });
            assertEquals(2, phase(c, "checkpoint").size());
            assertEquals(1, phase(c, "completed").size());
            assertEquals("EVIDENCE_SEALED", attr(c.last(), "recanet.last_confirmed_state"));
        }
    }

    @Test void boundedDedupCacheNeverDropsIndependentErrors() {
        try (var c = new SdkLogWorkflowTest.Capture()) {
            c.telemetry.observe("Test.root", null, () -> {
                for (int i = 0; i < 40; i++) {
                    assertThrows(DmrvnException.class, () -> c.telemetry.step("Test.rpc", () -> {
                        throw new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
                    }));
                }
                return true;
            });
            assertEquals(40, phase(c, "failed").size());
            assertEquals(1, phase(c, "completed").size());
        }
    }
}
