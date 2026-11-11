package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

/** v7 EIP-712, ABI and provenance commitments. Does not sign or send transactions. */
public final class DmrvnProtocol {
    /** Verifies source bytes against the stored Claim approver; no current role is consulted. */
    public static String verifyProvenance(
            Map<String, Object> evidence, String evidenceHash, String storedApprover) {
        require(Json.hash(evidence).equals(Crypto.bytes32(evidenceHash, "evidenceHash")), Code.SIGNATURE_INVALID);
        var body = Json.copy(evidence);
        var provenance = Json.map(body.remove("provenance"));
        String recovered =
                Crypto.recover(
                        Crypto.messageDigest("DMRVN v4 source:" + Json.hash(body)),
                        Json.str(provenance.get("sourceSignature"), "sourceSignature"));
        require(
                recovered.equals(Crypto.address(Json.str(provenance.get("signer"), "signer"), "signer"))
                        && recovered.equals(Crypto.address(storedApprover, "storedApprover")),
                Code.SIGNATURE_INVALID);
        return recovered;
    }

    static final Abi CLAIM = new Abi("dmrvn-claim-v7.json"),
            FORWARDER = new Abi("dmrvn-forwarder.json");
    static final List<Abi.Field> LOCATION =
            CLAIM.inputs("submitClaim").get(0).children().stream()
                    .filter(f -> f.name().equals("evidenceLocation"))
                    .findFirst()
                    .orElseThrow()
                    .children();
    static final Map<String, List<Abi.Field>> TYPES = new LinkedHashMap<>();

    static {
        TYPES.put("EvidenceLocation", LOCATION);
        TYPES.put("ClaimRequest", replaceLocation(CLAIM.inputs("submitClaim").get(0).children()));
        TYPES.put("TaskAssignment", CLAIM.inputs("onReport").get(0).children());
        TYPES.put("MrvObservation", CLAIM.inputs("onReport").get(3).children());
        TYPES.put(
                "ForwardRequest",
                List.of(
                        field("from", "address"),
                        field("to", "address"),
                        field("value", "uint256"),
                        field("gas", "uint256"),
                        field("nonce", "uint256"),
                        field("deadline", "uint48"),
                        field("data", "bytes")));
        TYPES.put(
                "EIP712Domain",
                List.of(
                        field("name", "string"),
                        field("version", "string"),
                        field("chainId", "uint256"),
                        field("verifyingContract", "address")));
    }

    private DmrvnProtocol() {}

    private static Abi.Field field(String name, String type) {
        return new Abi.Field(name, type, List.of());
    }

    private static List<Abi.Field> replaceLocation(List<Abi.Field> fields) {
        return fields.stream()
                .map(
                        f ->
                                f.name().equals("evidenceLocation")
                                        ? field(f.name(), "EvidenceLocation")
                                        : f)
                .toList();
    }

    public static Map<String, Object> domain(long chainId, String contract, boolean forwarder) {
        require(chainId > 0 && chainId <= 9007199254740991L, Code.INVALID_INPUT,
                "chainId", "must be between 1 and 9007199254740991 inclusive");
        return Json.obj(
                "name",
                forwarder ? "DMRVNForwarder" : "DMRVNClaimContract",
                "version",
                forwarder ? "1" : "7",
                "chainId",
                chainId,
                "verifyingContract",
                Crypto.address(contract, "verifyingContract"));
    }

    public static Map<String, Object> typedData(
            String type, Map<String, Object> domain, Map<String, Object> message) {
        require(TYPES.containsKey(type), Code.INVALID_INPUT, "primaryType", "must be a supported EIP-712 type");
        var types = new LinkedHashMap<String, Object>();
        types.put("EIP712Domain", typeFields("EIP712Domain"));
        types.put(type, typeFields(type));
        if (type.equals("ClaimRequest"))
            types.put("EvidenceLocation", typeFields("EvidenceLocation"));
        return Json.copy(
                Json.obj(
                        "domain", domain, "types", types, "primaryType", type, "message", message));
    }

    private static List<Object> typeFields(String type) {
        return TYPES.get(type).stream()
                .map(f -> (Object) Json.obj("name", f.name(), "type", f.type()))
                .toList();
    }

    public static String digest(
            String type, Map<String, Object> domain, Map<String, Object> message) {
        return Crypto.hash(
                Crypto.join(
                        new byte[] {0x19, 0x01},
                        Crypto.hex(structHash("EIP712Domain", domain)),
                        Crypto.hex(structHash(type, message))));
    }

    public static String structHash(String type, Map<String, Object> message) {
        require(TYPES.containsKey(type), Code.INVALID_INPUT, "primaryType", "must be a supported EIP-712 type");
        require(message != null, Code.INVALID_INPUT, type, "must be an object");
        String desc =
                description(type)
                        + (type.equals("ClaimRequest") ? description("EvidenceLocation") : "");
        var bytes = new java.io.ByteArrayOutputStream();
        bytes.writeBytes(Crypto.hex(Crypto.textHash(desc)));
        for (var f : TYPES.get(type)) {
            Object v = message.get(f.name());
            require(v != null, Code.INVALID_INPUT, type + "." + f.name(), "is required and must not be null");
            if (TYPES.containsKey(f.type()))
                bytes.writeBytes(Crypto.hex(input(type + "." + f.name(),
                        () -> structHash(f.type(), Json.map(v)))));
            else if (f.type().equals("string"))
                bytes.writeBytes(Crypto.hex(Crypto.textHash(Json.str(v, type + "." + f.name()))));
            else if (f.type().equals("bytes"))
                bytes.writeBytes(Crypto.hex(Crypto.hash(input(type + "." + f.name(), () -> Crypto.hex(Json.str(v))))));
            else bytes.writeBytes(input(type, () -> Abi.tuple(List.of(f), Map.of(f.name(), v))));
        }
        return Crypto.hash(bytes.toByteArray());
    }

    private static String description(String type) {
        return type
                + "("
                + String.join(
                        ",", TYPES.get(type).stream().map(f -> f.type() + " " + f.name()).toList())
                + ")";
    }

    public static String recover(String digest, String signature) {
        return Crypto.recover(digest, signature);
    }

    public static String ownerHash(String beneficiary) {
        return Crypto.textHash(Crypto.address(beneficiary, "beneficiary"));
    }

    public static String evidenceLocationHash(Map<String, Object> location) {
        return structHash("EvidenceLocation", location);
    }

    public static String submitCalldata(Map<String, Object> approved) {
        return CLAIM.encode(
                "submitClaim",
                Json.obj(
                        "request",
                        approved.get("claimRequest"),
                        "approvalSignature",
                        approved.get("approvalSignature")));
    }

    public static String executeCalldata(Map<String, Object> request, String signature) {
        return FORWARDER.encode("execute", Map.of("request", forwardCall(request, signature)));
    }

    static Map<String, Object> forwardCall(Map<String, Object> request, String signature) {
        var copy = Json.copy(request);
        copy.remove("nonce");
        copy.put("signature", signature);
        return copy;
    }

    static List<String> sortedAddresses(List<?> addresses) {
        var result = addresses.stream().map(x -> Crypto.address(Json.str(x))).sorted().toList();
        require(
                !result.isEmpty() && new HashSet<>(result).size() == result.size(),
                Code.REPORT_MISMATCH);
        return result;
    }

    static String committeeHash(Map<String, Object> a, List<Object> committee) {
        var fields =
                List.of(
                        field("taskId", "bytes32"),
                        field("claimId", "bytes32"),
                        field("quorumPolicyVersion", "uint32"),
                        field("committeeSize", "uint8"),
                        field("threshold", "uint8"),
                        field("deadline", "uint64"),
                        field("committee", "address[]"));
        var value = Json.copy(a);
        value.put("committee", committee);
        return Crypto.hash(Abi.tuple(fields, value));
    }

    static String reportHash(
            Map<String, Object> a,
            Map<String, Object> o,
            List<?> signers,
            Map<String, Object> domain) {
        var fields =
                List.of(
                        field("taskId", "bytes32"),
                        field("claimId", "bytes32"),
                        field("committeeHash", "bytes32"),
                        field("digest", "bytes32"),
                        field("signers", "address[]"));
        var v = Json.copy(a);
        v.put("digest", digest("MrvObservation", domain, o));
        v.put("signers", sortedAddresses(signers));
        return Crypto.hash(Abi.tuple(fields, v));
    }
}
