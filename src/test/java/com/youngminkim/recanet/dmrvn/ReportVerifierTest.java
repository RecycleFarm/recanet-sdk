package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.net.URI;
import java.util.*;

class ReportVerifierTest {
    static DmrvnConfig config() {
        var deployment =
                DmrvnDeployment.fromManifest(
                        Json.obj(
                                "chainId",
                                421614,
                                "contract",
                                Json.obj(
                                        "address",
                                        "0x1111111111111111111111111111111111111111",
                                        "domainVersion",
                                        "7",
                                        "runtimeCodeHash",
                                        Crypto.hash(Crypto.hex("0x01"))),
                                "forwarder",
                                Json.obj(
                                        "address",
                                        "0x2222222222222222222222222222222222222222",
                                        "domainVersion",
                                        "1",
                                        "runtimeCodeHash",
                                        Crypto.hash(Crypto.hex("0x01")))));
        return DmrvnConfig.fromDeployment(
                deployment,
                URI.create("https://example.com"),
                "5600",
                "offline-fixture",
                "partners/101/",
                101,
                BigInteger.TEN.pow(18),
                1);
    }

    static Map<String, Object> stored(Map<String, Object> f) {
        var c = Json.copy(Json.map(f.get("expectedFinalClaim")));
        var r = Json.map(f.get("claimRequest"));
        for (String k : List.of("partnerId", "activityId", "methodologyId", "methodologyVersion"))
            c.put(k, r.get(k));
        c.put("requestedAt", "1999999100");
        c.put("finalizedAt", "1999999200");
        return c;
    }

    static Map<String, Object> event(Map<String, Object> f) {
        var a = Json.map(f.get("assignment"));
        var c = stored(f);
        return Json.obj(
                "claimId",
                c.get("claimId"),
                "taskId",
                a.get("taskId"),
                "committeeHash",
                a.get("committeeHash"),
                "status",
                c.get("status"),
                "outputHash",
                c.get("outputHash"),
                "reportHash",
                c.get("reportHash"));
    }

    static Map<String, Object> verify(Map<String, Object> f, byte[] bytes, String expected) {
        return ReportVerifier.verify(
                config(),
                Json.str(Json.map(f.get("claimRequest")).get("claimId")),
                stored(f),
                event(f),
                Json.obj("to", config().claimAddress(), "input", f.get("onReportCalldata")),
                bytes,
                expected);
    }

    @Test
    void verifiesExactCalldataQuorumAndPet60() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var decoded =
                DmrvnProtocol.CLAIM.decodeCall("onReport", Json.str(f.get("onReportCalldata")));
        assertEquals(f.get("onReportCalldata"), DmrvnProtocol.CLAIM.encode("onReport", decoded));
        var result = verify(f, Json.bytes(f.get("report")), null);
        assertEquals(true, result.get("reportVerified"));
        assertEquals(f.get("reportFileHash"), result.get("fileHash"));
        assertEquals(
                "60", Json.map(Json.map(result.get("outputs")).get("estimated_co2e")).get("value"));
        assertEquals(false, result.get("metadataIndependentlyVerified"));
    }

    @Test
    void rejectsAlteredOutputsSignerObservationAndSource() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        for (String variant : List.of("outputs", "signer", "observation", "source")) {
            var report = Json.copy(Json.map(f.get("report")));
            switch (variant) {
                case "outputs" -> Json.map(Json.map(report.get("outputs")).get("estimated_co2e"))
                        .put("value", "61");
                case "signer" -> Json.map(Json.list(report.get("observations")).get(0))
                        .put("signer", "0x" + "00".repeat(20));
                case "observation" -> Json.map(
                                Json.map(Json.list(report.get("observations")).get(0))
                                        .get("observation"))
                        .put("deadline", "2000000001");
                case "source" -> Json.map(Json.map(report.get("source")).get("evidenceLocation"))
                        .put("objectName", "changed");
            }
            assertEquals(
                    DmrvnException.Code.REPORT_MISMATCH,
                    assertThrows(DmrvnException.class, () -> verify(f, Json.bytes(report), null))
                            .code(),
                    variant);
        }
    }

    @Test
    void metadataIsOnlyChecksumUnlessExternalCommitmentProvided() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var report = Json.copy(Json.map(f.get("report")));
        report.put("coefficientNotice", "changed metadata");
        assertEquals(true, verify(f, Json.bytes(report), null).get("reportVerified"));
        assertThrows(
                DmrvnException.class,
                () -> verify(f, Json.bytes(report), Json.str(f.get("reportFileHash"))));
    }
}
