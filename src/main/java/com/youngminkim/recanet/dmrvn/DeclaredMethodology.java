package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

/** Approved declared-input manifest and package commitments. Calculation remains in DMRVN nodes. */
public final class DeclaredMethodology {
    @FunctionalInterface
    public interface Registry {
        boolean isActive(long activityId, long id, long version, String methodologyHash);
    }

    public static final String PET_HASH =
            "0xdcc09ee621f2e388dd858f8f7399dbf2725cbec3526d52b0dd06909da892ff77";
    private final Map<String, Object> manifest;
    private final String hash;
    private final Registry registry;

    public DeclaredMethodology(
            byte[] manifestBytes, byte[] wasmBytes, String expectedHash, Registry registry) {
        this.manifest = Json.object(manifestBytes);
        this.hash = Crypto.bytes32(expectedHash);
        this.registry = Objects.requireNonNull(registry);
        require(
                Json.hash(manifest).equals(hash)
                        && Crypto.hash(wasmBytes).equals(manifest.get("wasmHash")),
                Code.METHODOLOGY_UNAVAILABLE);
        require(
                "PARTNER_DECLARED_INPUTS_V1".equals(manifest.get("evidenceSchema"))
                        && "DECLARED_INPUTS_V1"
                                .equals(Json.map(manifest.get("evidenceValidation")).get("kind")),
                Code.INVALID_INPUT);
    }

    public String hash() {
        return hash;
    }

    public long activityId() {
        return Crypto.uint(manifest.get("activityId"), 32).longValueExact();
    }

    public long id() {
        return Crypto.uint(Json.map(manifest.get("methodology")).get("id"), 32).longValueExact();
    }

    public long version() {
        return Crypto.uint(Json.map(manifest.get("methodology")).get("version"), 32)
                .longValueExact();
    }

    public void verifyActive() {
        require(
                registry.isActive(activityId(), id(), version(), hash),
                Code.METHODOLOGY_UNAVAILABLE);
    }

    public Map<String, Object> evidenceBody(
            long partnerId, String beneficiary, String sourceEventId, Map<String, Object> inputs) {
        var result =
                Json.obj(
                        "schemaVersion",
                        3,
                        "sourceEventId",
                        sourceEventId,
                        "partnerId",
                        partnerId,
                        "activityId",
                        activityId(),
                        "methodology",
                        Json.obj("id", id(), "version", version()),
                        "inputs",
                        Json.copy(inputs),
                        "source",
                        Json.obj(
                                "kind",
                                "PARTNER_DECLARED_INPUTS",
                                "ownerHash",
                                DmrvnProtocol.ownerHash(beneficiary)));
        validate(result, partnerId, beneficiary);
        return result;
    }

    void validate(Map<String, Object> body, long partnerId, String beneficiary) {
        require(
                body.keySet()
                        .equals(
                                Set.of(
                                        "schemaVersion",
                                        "sourceEventId",
                                        "partnerId",
                                        "activityId",
                                        "methodology",
                                        "inputs",
                                        "source")),
                Code.INVALID_INPUT);
        require(
                "3".equals(String.valueOf(body.get("schemaVersion")))
                        && Long.toString(partnerId).equals(String.valueOf(body.get("partnerId")))
                        && Long.toString(activityId())
                                .equals(String.valueOf(body.get("activityId"))),
                Code.INVALID_INPUT);
        require(
                Json.hash(body.get("methodology"))
                        .equals(Json.hash(Json.obj("id", id(), "version", version()))),
                Code.INVALID_INPUT);
        require(
                Json.str(body.get("sourceEventId")).matches("[A-Za-z0-9:_-]{1,128}"),
                Code.INVALID_INPUT);
        require(
                Json.hash(body.get("source"))
                        .equals(
                                Json.hash(
                                        Json.obj(
                                                "kind",
                                                "PARTNER_DECLARED_INPUTS",
                                                "ownerHash",
                                                DmrvnProtocol.ownerHash(beneficiary)))),
                Code.INVALID_INPUT);
        var inputs = Json.map(body.get("inputs"));
        var schema = Json.map(manifest.get("inputSchema"));
        require(inputs.keySet().equals(schema.keySet()), Code.INVALID_INPUT);
        for (var entry : schema.entrySet()) {
            var rule = Json.map(entry.getValue());
            Object value = inputs.get(entry.getKey());
            require(
                    "integer".equals(rule.get("type"))
                            && (value instanceof Integer
                                    || value instanceof Long
                                    || value instanceof java.math.BigInteger),
                    Code.INVALID_INPUT);
            var n = Crypto.uint(value, 53);
            require(
                    n.compareTo(Crypto.uint(rule.get("min"), 53)) >= 0
                            && n.compareTo(Crypto.uint(rule.get("max"), 53)) <= 0,
                    Code.INVALID_INPUT);
        }
        require(Json.bytes(body).length <= 1024 * 1024, Code.INVALID_INPUT);
    }
}
