package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import java.util.*;

class DmrvnReaderTest {
    private TestSupport.Rpc finalRpc(Map<String, Object> f) throws Exception {
        var rpc = new TestSupport.Rpc();
        rpc.claim = ReportVerifierTest.stored(f);
        var event = ReportVerifierTest.event(f);
        event.put("reporter", new TestSupport.Signer(8).address());
        var log =
                TestSupport.log(
                        DmrvnProtocol.CLAIM, "MrvClaimReported", rpc.config.claimAddress(), event);
        rpc.receipt =
                Json.obj(
                        "transactionHash",
                        TestSupport.TX,
                        "blockHash",
                        TestSupport.BLOCK,
                        "blockNumber",
                        "0x64",
                        "status",
                        "0x1",
                        "logs",
                        List.of(log));
        rpc.tx =
                Json.obj(
                        "hash",
                        TestSupport.TX,
                        "blockHash",
                        TestSupport.BLOCK,
                        "to",
                        rpc.config.claimAddress(),
                        "input",
                        f.get("onReportCalldata"));
        return rpc;
    }

    private DmrvnReader reader(TestSupport.Rpc rpc, DmrvnReader.ReportReader read) {
        return new DmrvnReader(
                rpc.config,
                rpc,
                read,
                DmrvnReader.defaultReportResolver("5600", "offline-fixture"));
    }

    private String id(Map<String, Object> f) {
        return Json.str(Json.map(f.get("claimRequest")).get("claimId"));
    }

    @Test
    void pendingTimeoutDoesNotInventExpiredTask() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var rpc = new TestSupport.Rpc();
        rpc.claim.put("status", 1);
        var result =
                reader(
                                rpc,
                                p -> {
                                    throw new AssertionError("No report should be fetched");
                                })
                        .readResult(id(f), null, null, true, null);
        assertEquals("PENDING", result.get("chainStatus"));
        assertEquals("LOCAL_WAIT_TIMEOUT", result.get("observationStatus"));
        assertEquals("UNKNOWN", result.get("taskStatus"));
    }

    @Test
    void storageErrorPropagatesWithoutReplacingItsMessage() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var rpc = finalRpc(f);
        var original = new RuntimeException("Original storage service explanation");
        assertSame(original, assertThrows(RuntimeException.class, () ->
                reader(
                                rpc,
                                p -> {
                                    throw original;
                                })
                        .readResult(id(f), null, TestSupport.TX, false, null)));
    }

    @Test
    void requiresBoundedSearchAndMatchesReceipt() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var rpc = finalRpc(f);
        var reader = reader(rpc, p -> Json.bytes(f.get("report")));
        assertEquals(
                "REPORT_LOOKUP_RANGE",
                Json.map(reader.readResult(id(f), null, null, false, null).get("reportError"))
                        .get("code"));
        assertEquals(true, reader.readResult(id(f), 0L, null, false, null).get("reportVerified"));
        rpc.receipt.put("status", "0x0");
        assertEquals(
                false,
                reader.readResult(id(f), null, TestSupport.TX, false, null).get("reportVerified"));
    }

    @Test
    void invalidIsVerifiedResultWithEmptyOutputs() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var call = DmrvnProtocol.CLAIM.decodeCall("onReport", Json.str(f.get("onReportCalldata")));
        var observation = Json.map(call.get("observation"));
        observation.put("result", 3);
        observation.put("outputHash", Crypto.ZERO);
        var domain =
                DmrvnProtocol.domain(421614, ReportVerifierTest.config().claimAddress(), false);
        String digest = DmrvnProtocol.digest("MrvObservation", domain, observation);
        var signers =
                List.of(
                        new TestSupport.Signer(3),
                        new TestSupport.Signer(4),
                        new TestSupport.Signer(5));
        var signatures = signers.stream().map(s -> (Object) s.sign(digest)).toList();
        call.put("observationSignatures", signatures);
        String hash =
                DmrvnProtocol.reportHash(
                        Json.map(call.get("assignment")),
                        observation,
                        signers.stream().map(TestSupport.Signer::address).toList(),
                        domain);
        var finalClaim = Json.map(f.get("expectedFinalClaim"));
        finalClaim.put("status", 3);
        finalClaim.put("outputHash", Crypto.ZERO);
        finalClaim.put("reportHash", hash);
        var report = Json.map(f.get("report"));
        report.put("result", 3);
        report.put("outputs", Map.of());
        report.put("reportHash", hash);
        var observations = new ArrayList<Object>();
        for (int i = 0; i < 3; i++)
            observations.add(
                    Json.obj(
                            "signer",
                            signers.get(i).address(),
                            "signature",
                            signatures.get(i),
                            "observation",
                            observation));
        report.put("observations", observations);
        f.put("onReportCalldata", DmrvnProtocol.CLAIM.encode("onReport", call));
        var rpc = finalRpc(f);
        var result =
                reader(rpc, p -> Json.bytes(report))
                        .readResult(id(f), null, TestSupport.TX, false, null);
        assertEquals("INVALID", result.get("chainStatus"));
        assertEquals(true, result.get("reportVerified"));
        assertEquals(Map.of(), result.get("outputs"));
    }
}
