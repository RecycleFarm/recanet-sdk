package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import java.util.*;

class DmrvnProtocolTest {
    static Map<String, Object> fixture() throws Exception {
        try (var s = DmrvnProtocolTest.class.getResourceAsStream("/dmrvn/pet.expected.json")) {
            return Json.object(s.readAllBytes());
        }
    }

    @Test
    void reproducesHandoffEvidenceClaimAndForwarder() throws Exception {
        var f = fixture();
        var evidence = Json.map(f.get("evidence"));
        var request = Json.map(f.get("claimRequest"));
        assertEquals(f.get("evidenceHash"), Json.hash(evidence));
        var domain =
                DmrvnProtocol.domain(421614, "0x1111111111111111111111111111111111111111", false);
        assertEquals(f.get("claimDigest"), DmrvnProtocol.digest("ClaimRequest", domain, request));
        var forward = Json.map(Json.map(f.get("sponsored")).get("forwardRequest"));
        var approved =
                Json.obj("claimRequest", request, "approvalSignature", f.get("approvalSignature"));
        assertEquals(forward.get("data"), DmrvnProtocol.submitCalldata(approved));
        var decoded = DmrvnProtocol.CLAIM.decodeCall("submitClaim", Json.str(forward.get("data")));
        assertEquals(
                Json.str(forward.get("data")), DmrvnProtocol.CLAIM.encode("submitClaim", decoded));
        var prov = Json.map(evidence.get("provenance"));
        var body = Json.copy(evidence);
        body.remove("provenance");
        assertEquals(
                Crypto.address(Json.str(prov.get("signer"))),
                Crypto.recover(
                        Crypto.messageDigest("DMRVN v4 source:" + Json.hash(body)),
                        Json.str(prov.get("sourceSignature"))));
    }

    @Test
    void rejectsUnsafeJsonAndDuplicateKeys() {
        for (Object value :
                Arrays.asList(Double.NaN, Double.POSITIVE_INFINITY, 9007199254740992L, "\ud800", new Object()))
            assertThrows(DmrvnException.class, () -> Json.canonical(value));
        assertEquals("1.2", Json.canonical(1.2));
        assertEquals("0", Json.canonical(-0.0));
        assertEquals("0.000001", Json.canonical(1e-6));
        assertEquals("1e-7", Json.canonical(1e-7));
        assertThrows(DmrvnException.class,
                () -> Json.canonical(new java.math.BigDecimal("0.123456789012345678901")));
        assertThrows(DmrvnException.class,
                () -> Json.parse("{\"reading\":0.123456789012345678901}".getBytes()));
        assertEquals("{\"reading\":1.25}",
                Json.canonical(Json.parse("{\"reading\":1.25}".getBytes())));
        assertThrows(DmrvnException.class, () -> Json.parse("{\"x\":1,\"x\":2}".getBytes()));
        assertThrows(DmrvnException.class, () -> Json.parse("{} {}".getBytes()));
        assertThrows(DmrvnException.class, () -> Json.parse("{\"count\":-0}".getBytes()));
        assertEquals(
                "{\"a\":[3,2,1],\"z\":\"한글\"}",
                Json.canonical(Map.of("z", "한글", "a", List.of(3, 2, 1))));
    }
}
