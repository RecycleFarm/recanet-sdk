package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InvalidInputMessageTest {
    private DmrvnException invalid(Runnable action, String field, String reason) {
        var error = assertThrows(DmrvnException.class, action::run);
        assertEquals(DmrvnException.Code.INVALID_INPUT, error.code());
        assertTrue(error.getMessage().startsWith("INVALID_INPUT: " + field + ":"), error::getMessage);
        assertTrue(error.getMessage().contains(reason), error::getMessage);
        assertTrue(error.getMessage().chars().allMatch(c -> c < 128), error::getMessage);
        return error;
    }

    private ActivityRequest request(String user, String event, Map<String, Object> inputs,
                                    String claim, String gas, Duration timeout, Duration interval) {
        return new ActivityRequest(user, event, inputs, claim, null, gas, timeout, interval);
    }

    @Test void identifiesEachRequestFieldWithoutEchoingRejectedValues() {
        invalid(() -> new ActivityRequest(" ", "event", Map.of()), "userId", "must not be null or blank");
        var error = invalid(() -> new ActivityRequest("member", "sensitive-invalid-event/secret", Map.of()),
                "sourceEventId", "1 to 128");
        assertFalse(error.getMessage().contains("secret"));
        invalid(() -> new ActivityRequest("member", "event", null), "inputs", "must not be null");
        invalid(() -> request("member", "event", Map.of(), "0x12", "900000", Duration.ZERO, Duration.ofSeconds(1)),
                "claimId", "exactly 32 bytes");
        invalid(() -> request("member", "event", Map.of(), null, "abc", Duration.ZERO, Duration.ofSeconds(1)),
                "gas", "non-negative decimal integer");
        invalid(() -> request("member", "event", Map.of(), null, "99999", Duration.ZERO, Duration.ofSeconds(1)),
                "gas", "100000 and 2000000");
        invalid(() -> request("member", "event", Map.of(), null, "900000", null, Duration.ofSeconds(1)),
                "confirmationTimeout", "0 and 10 minutes");
        invalid(() -> request("member", "event", Map.of(), null, "900000", Duration.ZERO, Duration.ZERO),
                "pollInterval", "1 millisecond and 10 seconds");
        assertDoesNotThrow(() -> request("member", "event", Map.of(), null, "100000", Duration.ZERO, Duration.ofMillis(1)));
        assertDoesNotThrow(() -> request("member", "event", Map.of(), null, "2000000", Duration.ofMinutes(10), Duration.ofSeconds(10)));
    }

    @Test void preservesNestedJsonFieldAndArrayIndex() {
        invalid(() -> new ActivityRequest("member", "event", Map.of("counts", List.of(1, Double.NaN))),
                "inputs.counts[1]", "must be finite");
        invalid(() -> Json.bytes(Map.of("count", new BigInteger("9007199254740992"))),
                "$.count", "safe range");
        invalid(() -> Json.bytes(Map.of("rate", new BigDecimal("0.123456789012345678901"))),
                "$.rate", "without value loss");
        invalid(() -> Json.bytes(Map.of("name", "\uD800")), "$.name", "unpaired Unicode surrogate");
        invalid(() -> Json.bytes(Map.of("object", new Object())), "$.object", "supported JSON value");
        invalid(() -> Json.bytes(Map.of(1, "secret")), "$", "keys must be strings");
    }

    @Test void distinguishesJsonSyntaxEncodingDuplicateKeysAndNegativeZero() {
        invalid(() -> Json.parse(new byte[]{(byte) 0xff}), "json", "valid UTF-8");
        invalid(() -> Json.parse("{\"count\":-0}".getBytes(StandardCharsets.UTF_8)), "$/count", "token -0");
        var duplicate = assertThrows(DmrvnException.class,
                () -> Json.parse("{\"count\":1,\"count\":2}".getBytes(StandardCharsets.UTF_8)));
        assertEquals(DmrvnException.Code.INVALID_INPUT, duplicate.code());
        assertTrue(duplicate.getMessage().contains("count"), duplicate::getMessage);
        assertTrue(duplicate.getMessage().contains("duplicate object keys"), duplicate::getMessage);
        assertTrue(duplicate.getMessage().contains("line 1"), duplicate::getMessage);
        invalid(() -> Json.parse("{} {}".getBytes(StandardCharsets.UTF_8)), "json", "exactly one top-level");
    }

    @Test void identifiesConfigFieldInsteadOfCombiningAllSettings() {
        var d = DmrvnDeployment.testnet();
        invalid(() -> DmrvnConfig.fromDeployment(d, URI.create("https://rpc.example"), "5600", "ab",
                "prefix/", 101, BigInteger.ONE, 1), "bucketName", "3 to 63");
        invalid(() -> DmrvnConfig.fromDeployment(d, URI.create("https://rpc.example"), "5600", "bucket",
                "prefix/", 101, BigInteger.ZERO, 1), "maxRelayCostWei", "positive integer");
        invalid(() -> DmrvnConfig.fromDeployment(d, URI.create("https://rpc.example"), "5600", "bucket",
                "prefix/", 101, BigInteger.ONE, 0), "confirmations", "at least 1");
        invalid(() -> DmrvnConfig.fromDeployment(d, URI.create("http://rpc.example"), "5600", "bucket",
                "prefix/", 101, BigInteger.ONE, 1), "rpcUrl", "HTTPS");
    }

    @Test void abiAndTypedDataPreserveFieldNames() {
        invalid(() -> Abi.tuple(List.of(new Abi.Field("amount", "uint8", List.of())), Map.of("amount", 256)),
                "amount", "uint8");
        invalid(() -> DmrvnProtocol.structHash("ForwardRequest", Map.of()),
                "ForwardRequest.from", "is required");
        invalid(() -> Abi.tuple(List.of(new Abi.Field("enabled", "bool", List.of())), Map.of("enabled", "true")),
                "enabled", "boolean");
    }

    @Test void manifestKeepsDeploymentCodeAndSpecificDiagnostic() {
        var manifest = DmrvnDeployment.testnet().snapshot();
        manifest.put("chainId", 0);
        var error = assertThrows(DmrvnException.class, () -> DmrvnDeployment.fromManifest(manifest));
        assertEquals(DmrvnException.Code.DEPLOYMENT_NOT_READY, error.code());
        assertTrue(error.getMessage().contains("manifest.chainId: must be greater than 0"), error::getMessage);
    }

    @Test void evidenceValidationNamesTheExactCommitmentField() throws Exception {
        try (var manifest = getClass().getResourceAsStream("/dmrvn/pet-manifest.json");
             var wasm = getClass().getResourceAsStream("/dmrvn/pet-methodology.wasm")) {
            var methodology = new DeclaredMethodology(manifest.readAllBytes(), wasm.readAllBytes(),
                    DeclaredMethodology.PET_HASH, (a, id, version, hash) -> true, 999);
            String beneficiary = new TestSupport.Signer(1).address();
            for (String field : List.of("schemaVersion", "partnerId", "activityId")) {
                var body = methodology.evidenceBody(101, beneficiary, "event", Map.of());
                body.put(field, 0);
                invalid(() -> methodology.validate(body, 101, beneficiary), "evidence." + field, "must match");
            }
            var body = methodology.evidenceBody(101, beneficiary, "event", Map.of());
            body.put("inputs", List.of());
            invalid(() -> methodology.validate(body, 101, beneficiary), "evidence.inputs", "JSON object");
        }
    }

    @Test void readerReturnsInvalidFieldMessageInReportError() throws Exception {
        var f = DmrvnProtocolTest.fixture();
        var rpc = new TestSupport.Rpc();
        rpc.claim = ReportVerifierTest.stored(f);
        var reader = new DmrvnReader(rpc.config, rpc, pointer -> new byte[0],
                DmrvnReader.defaultReportResolver("5600", "bucket"));
        String claim = Json.str(Json.map(f.get("claimRequest")).get("claimId"));
        var result = reader.readResult(claim, null, "invalid-secret-hash", false, null);
        var error = Json.map(result.get("reportError"));
        assertEquals("INVALID_INPUT", error.get("code"));
        assertTrue(error.get("message").toString().contains("reportTxHash:"));
        assertFalse(error.get("message").toString().contains("secret"));
    }

    @Test void fieldContextNeverWrapsUpstreamFailures() {
        var original = new RuntimeException("original upstream message");
        assertSame(original, assertThrows(RuntimeException.class,
                () -> DmrvnException.input("gas", () -> { throw original; })));
    }
}
