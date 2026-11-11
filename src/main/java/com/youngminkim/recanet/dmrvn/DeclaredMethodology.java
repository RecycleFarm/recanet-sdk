package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

/** Approved methodology/package commitments. Input interpretation belongs to DMRVN nodes. */
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
    private final int evidenceSchemaVersion;
    private final boolean explicitEvidenceVersion;

    public DeclaredMethodology(
            byte[] manifestBytes, byte[] wasmBytes, String expectedHash, Registry registry) {
        this(manifestBytes, wasmBytes, expectedHash, registry, 3, false);
    }

    /**
     * Explicit integration setting for the shared common Evidence fields and JCS encoding.
     * The specification has not finalized the new wire version; obtain it from the DMRVN operator.
     * Supplying a value is not proof that validators support it. Historical fixtures stay unchanged.
     */
    public DeclaredMethodology(byte[] manifestBytes, byte[] wasmBytes, String expectedHash,
                               Registry registry, int evidenceSchemaVersion) {
        this(manifestBytes, wasmBytes, expectedHash, registry, evidenceSchemaVersion, true);
    }

    private DeclaredMethodology(byte[] manifestBytes, byte[] wasmBytes, String expectedHash,
                                Registry registry, int evidenceSchemaVersion, boolean explicit) {
        this.manifest = input("manifest", () -> Json.object(manifestBytes));
        this.hash = Crypto.bytes32(expectedHash, "expectedHash");
        this.registry = Objects.requireNonNull(registry);
        require(evidenceSchemaVersion > 0, Code.INVALID_INPUT,
                "evidenceSchemaVersion", "must be greater than 0");
        this.evidenceSchemaVersion = evidenceSchemaVersion;
        this.explicitEvidenceVersion = explicit;
        require(
                Json.hash(manifest).equals(hash)
                        && Crypto.hash(wasmBytes).equals(manifest.get("wasmHash")),
                Code.METHODOLOGY_UNAVAILABLE);
        // Do not select a partner input profile from evidenceSchema/evidenceValidation.
        activityId();
        id();
        version();
    }

    public String hash() {
        return hash;
    }

    public long activityId() {
        return Crypto.uint(manifest.get("activityId"), 32, "manifest.activityId").longValueExact();
    }

    public long id() {
        return Crypto.uint(Json.map(manifest.get("methodology"), "manifest.methodology").get("id"),
                32, "manifest.methodology.id").longValueExact();
    }

    public long version() {
        return Crypto.uint(Json.map(manifest.get("methodology"), "manifest.methodology").get("version"),
                        32, "manifest.methodology.version")
                .longValueExact();
    }

    public void verifyActive() {
        require(
                registry.isActive(activityId(), id(), version(), hash),
                Code.METHODOLOGY_UNAVAILABLE);
    }

    void requireExplicitEvidenceVersion() {
        require(explicitEvidenceVersion, Code.EVIDENCE_CONTRACT_UNCONFIGURED);
    }

    public Map<String, Object> evidenceBody(
            long partnerId, String beneficiary, String sourceEventId, Map<String, Object> inputs) {
        var result =
                Json.obj(
                        "schemaVersion",
                        evidenceSchemaVersion,
                        "sourceEventId",
                        sourceEventId,
                        "partnerId",
                        partnerId,
                        "activityId",
                        activityId(),
                        "methodology",
                        Json.obj("id", id(), "version", version()),
                        "inputs",
                        Json.copy(inputs, "inputs"),
                        "source",
                        Json.obj(
                                "ownerHash",
                                DmrvnProtocol.ownerHash(beneficiary)));
        validate(result, partnerId, beneficiary);
        return result;
    }

    void validate(Map<String, Object> body, long partnerId, String beneficiary) {
        require(body != null, Code.INVALID_INPUT, "evidence", "must be a JSON object");
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
                Code.INVALID_INPUT, "evidence", "must contain exactly schemaVersion, sourceEventId, partnerId, activityId, methodology, inputs and source");
        require(
                Integer.toString(evidenceSchemaVersion).equals(String.valueOf(body.get("schemaVersion"))),
                Code.INVALID_INPUT, "evidence.schemaVersion", "must match the configured Evidence schema version");
        require(Long.toString(partnerId).equals(String.valueOf(body.get("partnerId"))),
                Code.INVALID_INPUT, "evidence.partnerId", "must match the configured partner ID");
        require(Long.toString(activityId()).equals(String.valueOf(body.get("activityId"))),
                Code.INVALID_INPUT, "evidence.activityId", "must match the declared methodology activity ID");
        require(
                Json.hash(body.get("methodology"))
                        .equals(Json.hash(Json.obj("id", id(), "version", version()))),
                Code.INVALID_INPUT, "evidence.methodology", "must match the declared methodology id and version exactly");
        require(
                Json.str(body.get("sourceEventId"), "evidence.sourceEventId").matches("[A-Za-z0-9:_-]{1,128}"),
                Code.INVALID_INPUT, "evidence.sourceEventId", "must contain 1 to 128 letters, digits, colons, underscores or hyphens");
        require(
                Json.hash(body.get("source"))
                        .equals(
                                Json.hash(
                                        Json.obj(
                                                "ownerHash",
                                                DmrvnProtocol.ownerHash(beneficiary)))),
                Code.INVALID_INPUT, "evidence.source.ownerHash", "source must contain only ownerHash and it must match the beneficiary wallet");
        Json.map(body.get("inputs"), "evidence.inputs");
        require(Json.bytes(body).length <= 1024 * 1024, Code.INVALID_INPUT,
                "evidence", "serialized Evidence must not exceed 1048576 bytes");
    }
}
