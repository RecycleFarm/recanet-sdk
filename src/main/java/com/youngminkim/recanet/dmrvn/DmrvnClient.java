package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.math.BigInteger;
import java.util.*;
import java.util.function.Supplier;

/** Partner-side DMRVN v7 workflow with immutable preparation and conservative recovery. */
public final class DmrvnClient {
    private final DmrvnConfig config;
    private final Chain chain;
    private final EvmSigner approver, relay;
    private final GreenfieldStorage storage;
    private final DeclaredMethodology methodology;
    private final OperationJournal journal;

    public DmrvnClient(
            DmrvnConfig config,
            EvmRpc rpc,
            EvmSigner approver,
            EvmSigner relay,
            GreenfieldStorage storage,
            DeclaredMethodology methodology,
            OperationJournal journal) {
        this.config = Objects.requireNonNull(config);
        this.chain = new Chain(config, Objects.requireNonNull(rpc));
        this.approver = Objects.requireNonNull(approver);
        this.relay = Objects.requireNonNull(relay);
        this.storage = Objects.requireNonNull(storage);
        this.methodology = Objects.requireNonNull(methodology);
        this.journal = Objects.requireNonNull(journal);
        Crypto.address(approver.address());
        Crypto.address(relay.address());
        Crypto.address(storage.address());
        require(config.greenfieldChainId().equals(storage.chainId()), Code.WRONG_CHAIN);
    }

    /**
     * Performs reads only. Storage write/read and validator access require an actual object test.
     */
    public Map<String, Object> preflight() {
        var checks = new LinkedHashMap<String, Object>();
        check(
                checks,
                "deployment",
                () -> {
                    config.deployment().requireWritable();
                    return chain.verifyDeployment();
                });
        check(
                checks,
                "approverRole",
                () -> {
                    chain.verifyApprover(approver.address());
                    return true;
                });
        check(
                checks,
                "methodology",
                () -> {
                    methodology.verifyActive();
                    return true;
                });
        check(
                checks,
                "relayBalanceWei",
                () ->
                        Chain.number(
                                        chain.call(
                                                "eth_getBalance",
                                                Crypto.address(relay.address()),
                                                "latest"))
                                .toString());
        checks.put("greenfieldWriteRead", "NOT_TESTED");
        checks.put("validatorReadAccess", "OPERATOR_CONFIRMATION_REQUIRED");
        return Json.obj(
                "deploymentId",
                config.deploymentId(),
                "ready",
                checks.values().stream()
                        .filter(v -> v instanceof Map)
                        .map(Json::map)
                        .allMatch(v -> Boolean.TRUE.equals(v.get("ok"))),
                "verifiedMetadata",
                Json.map(checks.get("deployment")).get("value"),
                "approver",
                Crypto.address(approver.address()),
                "relay",
                Crypto.address(relay.address()),
                "storageSigner",
                Crypto.address(storage.address()),
                "checks",
                checks);
    }

    private static void check(Map<String, Object> result, String name, Supplier<Object> fn) {
        try {
            result.put(name, Json.obj("ok", true, "value", fn.get()));
        } catch (DmrvnException e) {
            result.put(name, Json.obj("ok", false, "code", e.code().name()));
        }
    }

    private static String operationKey(String id) {
        require(id != null && id.matches("[A-Za-z0-9:_-]{1,128}"), Code.INVALID_INPUT);
        return "operation:" + id;
    }

    private String beneficiaryKey(String address) {
        return "claim-nonce:" + config.deploymentId() + ":" + Crypto.address(address);
    }

    private String relayKey() {
        return "relay-nonce:" + config.chainId() + ":" + Crypto.address(relay.address());
    }

    private String configurationFingerprint() {
        return Json.hash(
                Json.obj(
                        "deployment",
                        config.deploymentId(),
                        "forwarder",
                        config.forwarderAddress(),
                        "methodologyHash",
                        methodology.hash(),
                        "partnerId",
                        config.partnerId(),
                        "bucket",
                        config.bucketName(),
                        "prefix",
                        config.objectPrefix(),
                        "greenfieldChainId",
                        config.greenfieldChainId(),
                        "approver",
                        Crypto.address(approver.address()),
                        "relay",
                        Crypto.address(relay.address()),
                        "storage",
                        Crypto.address(storage.address())));
    }

    private Map<String, Object> required(String key) {
        var s = journal.load(key);
        require(s != null, Code.OPERATION_NOT_PREPARED);
        require(config.deploymentId().equals(s.get("deploymentId")), Code.DEPLOYMENT_COLLISION);
        require(
                configurationFingerprint().equals(s.get("configurationFingerprint")),
                Code.OPERATION_INPUT_CHANGED);
        return s;
    }

    private Map<String, Object> verifyState(
            String key, Map<String, Object> state, boolean writing) {
        state.remove("verifiedMetadata");
        state.put("ready", false);
        save(key, state);
        try {
            if (writing) config.deployment().requireWritable();
            if (state.containsKey("deployment"))
                config.deployment().assertCompatible(Json.map(state.get("deployment")));
            var verified = chain.verifyDeployment();
            // Pre-migration direct records can be enriched only from their exact original route.
            if (!state.containsKey("deployment")) {
                require(!config.deployment().isProxy(), Code.DEPLOYMENT_NOT_READY);
                state.put("deployment", verified);
            }
            state.put("verifiedMetadata", verified);
            state.put("ready", true);
            state.remove("deploymentError");
            save(key, state);
            return verified;
        } catch (DmrvnException e) {
            state.put("deploymentError", e.code().name());
            save(key, state);
            throw e;
        }
    }

    private void reserveClaim(String claimId, String operationId) {
        String key = "claim-id:" + claimId;
        journal.withLock(
                key,
                () -> {
                    var entries = new ArrayList<>(journal.findOperationsByClaimId(claimId));
                    var reservation = journal.load(key);
                    if (reservation != null && !reservation.isEmpty()) entries.add(reservation);
                    for (var entry : entries) {
                        require(
                                config.deploymentId()
                                        .equalsIgnoreCase(
                                                String.valueOf(entry.get("deploymentId"))),
                                Code.DEPLOYMENT_COLLISION);
                        require(operationId.equals(entry.get("operationId")), Code.NONCE_CONFLICT);
                    }
                    journal.store(
                            key,
                            Json.obj(
                                    "claimId",
                                    claimId,
                                    "deploymentId",
                                    config.deploymentId(),
                                    "operationId",
                                    operationId));
                    return null;
                });
    }

    private void verifyBeforeSubmission(Map<String, Object> state) {
        var approved = Json.map(state.get("approved"));
        var request = Json.map(approved.get("claimRequest"));
        String signer =
                Crypto.recover(
                        DmrvnProtocol.digest(
                                "ClaimRequest",
                                DmrvnProtocol.domain(
                                        config.chainId(), config.claimAddress(), false),
                                request),
                        Json.str(approved.get("approvalSignature")));
        DmrvnProtocol.verifyProvenance(
                Json.map(state.get("evidence")), Json.str(request.get("evidenceHash")), signer);
        chain.verifyApprover(signer);
        validateCurrent(request);
    }

    private Map<String, Object> approved(String key) {
        var s = required(key);
        require(s.containsKey("approved"), Code.OPERATION_NOT_PREPARED);
        return s;
    }

    private void save(String key, Map<String, Object> state) {
        journal.store(key, Json.copy(state));
    }

    private static void reserve(OperationJournal journal, String key, String operation) {
        var r = journal.load(key);
        require(
                r == null || r.isEmpty() || operation.equals(r.get("operationId")),
                Code.NONCE_CONFLICT);
        journal.store(key, Map.of("operationId", operation));
    }

    /**
     * Signs, creates/uploads, waits for SEALED and compares actual stored bytes. Safe to resume by
     * operationId.
     */
    public Map<String, Object> prepareEvidence(
            String operationId,
            String claimId,
            String beneficiary,
            String objectName,
            Map<String, Object> evidenceBody) {
        String key = operationKey(operationId),
                id = Crypto.bytes32(claimId),
                user = Crypto.address(beneficiary);
        config.checkObject(objectName);
        var body = Json.copy(evidenceBody);
        methodology.validate(body, config.partnerId(), user);
        String fingerprint =
                Json.hash(
                        Json.obj(
                                "body",
                                body,
                                "claimId",
                                id,
                                "beneficiary",
                                user,
                                "objectName",
                                objectName,
                                "deploymentId",
                                config.deploymentId(),
                                "forwarder",
                                config.forwarderAddress(),
                                "methodologyHash",
                                methodology.hash(),
                                "greenfieldChainId",
                                config.greenfieldChainId(),
                                "bucket",
                                config.bucketName(),
                                "prefix",
                                config.objectPrefix(),
                                "relay",
                                Crypto.address(relay.address()),
                                "approver",
                                Crypto.address(approver.address()),
                                "storageSigner",
                                Crypto.address(storage.address())));
        return journal.withLock(
                key,
                () -> {
                    var state = journal.load(key);
                    if (state != null)
                        require(
                                config.deploymentId().equals(state.get("deploymentId")),
                                Code.DEPLOYMENT_COLLISION);
                    if (state != null)
                        require(
                                fingerprint.equals(state.get("fingerprint")),
                                Code.OPERATION_INPUT_CHANGED);
                    Map<String, Object> firstDeployment = null;
                    if (state == null) {
                        config.deployment().requireWritable();
                        firstDeployment = chain.verifyDeployment();
                    }
                    reserveClaim(id, operationId);
                    if (state == null) {
                        state =
                                Json.obj(
                                        "operationId",
                                        operationId,
                                        "deploymentId",
                                        config.deploymentId(),
                                        "deployment",
                                        firstDeployment,
                                        "fingerprint",
                                        fingerprint,
                                        "configurationFingerprint",
                                        configurationFingerprint(),
                                        "body",
                                        body,
                                        "claimId",
                                        id,
                                        "beneficiary",
                                        user,
                                        "phase",
                                        "PREPARING");
                        save(key, state);
                    }
                    String sourceKey =
                            "source:"
                                    + config.deploymentId()
                                    + ":"
                                    + config.partnerId()
                                    + ":"
                                    + methodology.activityId()
                                    + ":"
                                    + body.get("sourceEventId");
                    journal.withLock(
                            sourceKey,
                            () -> {
                                reserve(journal, sourceKey, operationId);
                                return null;
                            });
                    verifyState(key, state, !state.containsKey("upload"));
                    if (state.containsKey("upload")) return Json.copy(state);
                    chain.verifyApprover(approver.address());
                    methodology.verifyActive();
                    if (!state.containsKey("evidence")) {
                        String message = "DMRVN v4 source:" + Json.hash(body);
                        String signature = approver.signMessage(message);
                        require(
                                Crypto.recover(Crypto.messageDigest(message), signature)
                                        .equals(Crypto.address(approver.address())),
                                Code.SIGNATURE_INVALID);
                        var evidence = Json.copy(body);
                        evidence.put(
                                "provenance",
                                Json.obj(
                                        "signer",
                                        approver.address(),
                                        "sourceSignature",
                                        signature));
                        require(Json.bytes(evidence).length <= 1024 * 1024, Code.INVALID_INPUT);
                        state.put("evidence", evidence);
                        save(key, state);
                    }
                    byte[] bytes = Json.bytes(state.get("evidence"));
                    var location =
                            Json.obj(
                                    "storageType",
                                    1,
                                    "chainId",
                                    config.greenfieldChainId(),
                                    "bucketName",
                                    config.bucketName(),
                                    "objectName",
                                    objectName);
                    state.put("evidenceLocation", location);
                    save(key, state);
                    var head = storage.head(location);
                    if (!head.exists()) {
                        // A previous create attempt may still be pending. Absence is not proof it
                        // was never sent.
                        require(!state.containsKey("createIntent"), Code.STORAGE_CREATE_UNRESOLVED);
                        state.put("createIntent", true);
                        save(key, state);
                        String txHash;
                        try {
                            txHash = storage.create(location, bytes);
                        } catch (DmrvnException e) {
                            if (e.definitelyNotBroadcast() || e.definitelyRejected()) {
                                state.remove("createIntent");
                                state.put("lastStorageError", e.code().name());
                                save(key, state);
                            }
                            throw e;
                        }
                        require(
                                txHash != null && !txHash.isBlank(),
                                Code.STORAGE_CREATE_UNRESOLVED);
                        state.put("createTxHash", txHash);
                        save(key, state);
                        head = storage.head(location);
                    }
                    if (!head.sealed()) {
                        require(
                                state.get("createTxHash") instanceof String,
                                Code.STORAGE_CREATE_UNRESOLVED);
                        storage.upload(location, bytes, Json.str(state.get("createTxHash")));
                    }
                    require(storage.head(location).sealed(), Code.OBJECT_UNSEALED);
                    require(Arrays.equals(bytes, storage.read(location)), Code.STORAGE_MISMATCH);
                    var upload =
                            Json.obj(
                                    "evidenceHash",
                                    Json.hash(state.get("evidence")),
                                    "evidenceLocation",
                                    location,
                                    "createTxHash",
                                    state.get("createTxHash"),
                                    "status",
                                    "SEALED");
                    state.put("upload", upload);
                    state.remove("lastStorageError");
                    save(key, state);
                    return Json.copy(state);
                });
    }

    /**
     * Reconciles a lost CreateObject response using a verified original transaction; never creates
     * again.
     */
    public void recoverCreateTransaction(String operationId, String createTxHash) {
        String key = operationKey(operationId);
        journal.withLock(
                key,
                () -> {
                    var s = required(key);
                    require(
                            s.containsKey("createIntent") && s.containsKey("evidenceLocation"),
                            Code.OPERATION_NOT_PREPARED);
                    require(
                            storage.matchesCreateTransaction(
                                    Json.map(s.get("evidenceLocation")), createTxHash),
                            Code.STORAGE_MISMATCH);
                    if (s.containsKey("createTxHash"))
                        require(
                                createTxHash.equals(s.get("createTxHash")),
                                Code.OPERATION_INPUT_CHANGED);
                    s.put("createTxHash", createTxHash);
                    save(key, s);
                    return null;
                });
    }

    /**
     * Creates one common Claim approval after checking actual storage and the approved methodology.
     */
    public Map<String, Object> approveClaim(String operationId) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = required(key);
                    require(s.containsKey("upload"), Code.OPERATION_NOT_PREPARED);
                    verifyState(key, s, true);
                    if (s.containsKey("approved")) return Json.copy(Json.map(s.get("approved")));
                    chain.verifyApprover(approver.address());
                    DmrvnProtocol.verifyProvenance(
                            Json.map(s.get("evidence")),
                            Json.hash(s.get("evidence")),
                            approver.address());
                    methodology.verifyActive();
                    var location = Json.map(s.get("evidenceLocation"));
                    require(storage.head(location).sealed(), Code.OBJECT_UNSEALED);
                    require(
                            Arrays.equals(Json.bytes(s.get("evidence")), storage.read(location)),
                            Code.STORAGE_MISMATCH);
                    String user = Json.str(s.get("beneficiary"));
                    methodology.validate(Json.map(s.get("body")), config.partnerId(), user);
                    return journal.withLock(
                            beneficiaryKey(user),
                            () -> {
                                reserve(journal, beneficiaryKey(user), operationId);
                                if (!s.containsKey("claimRequest")) {
                                    var request =
                                            Json.obj(
                                                    "claimId",
                                                    s.get("claimId"),
                                                    "beneficiary",
                                                    user,
                                                    "partnerId",
                                                    config.partnerId(),
                                                    "activityId",
                                                    methodology.activityId(),
                                                    "methodologyId",
                                                    methodology.id(),
                                                    "methodologyVersion",
                                                    methodology.version(),
                                                    "evidenceHash",
                                                    Json.hash(s.get("evidence")),
                                                    "methodologyHash",
                                                    methodology.hash(),
                                                    "evidenceLocation",
                                                    location,
                                                    "nonce",
                                                    chain.nonce(user, false).toString(),
                                                    "deadline",
                                                    Long.toString(
                                                            Math.addExact(chain.timestamp(), 900)));
                                    s.put("claimRequest", request);
                                    save(key, s);
                                }
                                var request = Json.map(s.get("claimRequest"));
                                validateCurrent(request);
                                var domain =
                                        DmrvnProtocol.domain(
                                                config.chainId(), config.claimAddress(), false);
                                String digest =
                                        DmrvnProtocol.digest("ClaimRequest", domain, request);
                                String signature =
                                        approver.signTypedData(
                                                DmrvnProtocol.typedData(
                                                        "ClaimRequest", domain, request));
                                require(
                                        Crypto.recover(digest, signature)
                                                .equals(Crypto.address(approver.address())),
                                        Code.SIGNATURE_INVALID);
                                var value =
                                        Json.obj(
                                                "claimRequest",
                                                request,
                                                "approvalSignature",
                                                signature,
                                                "approvalDigest",
                                                digest,
                                                "deployment",
                                                s.get("deployment"));
                                s.put("approved", value);
                                s.put("phase", "APPROVED");
                                save(key, s);
                                return Json.copy(value);
                            });
                });
    }

    public Map<String, Object> prepare(
            String operationId,
            String claimId,
            String beneficiary,
            String objectName,
            Map<String, Object> evidenceBody) {
        prepareEvidence(operationId, claimId, beneficiary, objectName, evidenceBody);
        return approveClaim(operationId);
    }

    private void validateCurrent(Map<String, Object> request) {
        require(
                Crypto.uint(request.get("deadline"), 64)
                                .compareTo(BigInteger.valueOf(chain.timestamp()))
                        > 0,
                Code.REQUEST_EXPIRED);
        require(
                chain.nonce(Json.str(request.get("beneficiary")), false)
                        .equals(Crypto.uint(request.get("nonce"), 256)),
                Code.NONCE_CONFLICT);
    }

    private Map<String, Object> selfPaid(Map<String, Object> approved) {
        return Json.obj(
                "chainId",
                config.chainId(),
                "to",
                config.claimAddress(),
                "value",
                "0",
                "data",
                DmrvnProtocol.submitCalldata(approved));
    }

    /**
     * Returns EIP-712 for the app to sign once. gas is the signed target-call gas and is never
     * rewritten.
     */
    public Map<String, Object> prepareSponsored(String operationId, String gas) {
        String key = operationKey(operationId);
        BigInteger gasValue = Crypto.uint(gas, 256);
        require(
                gasValue.compareTo(BigInteger.valueOf(100000)) >= 0
                        && gasValue.compareTo(BigInteger.valueOf(2000000)) <= 0,
                Code.INVALID_INPUT);
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    verifyState(key, s, true);
                    require(
                            !"SELF_PAID".equals(s.get("submissionMode")),
                            Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("sponsored")) {
                        var existing = Json.map(s.get("sponsored"));
                        require(
                                gas.equals(Json.map(existing.get("forwardRequest")).get("gas")),
                                Code.SUBMISSION_INPUT_CHANGED);
                        return Json.copy(existing);
                    }
                    var a = Json.map(s.get("approved"));
                    var request = Json.map(a.get("claimRequest"));
                    verifyBeforeSubmission(s);
                    var forward =
                            Json.obj(
                                    "from",
                                    request.get("beneficiary"),
                                    "to",
                                    config.claimAddress(),
                                    "value",
                                    "0",
                                    "gas",
                                    gas,
                                    "nonce",
                                    chain.nonce(Json.str(request.get("beneficiary")), true)
                                            .toString(),
                                    "deadline",
                                    request.get("deadline"),
                                    "data",
                                    DmrvnProtocol.submitCalldata(a));
                    var domain =
                            DmrvnProtocol.domain(config.chainId(), config.forwarderAddress(), true);
                    var typed = DmrvnProtocol.typedData("ForwardRequest", domain, forward);
                    var result =
                            Json.obj(
                                    "forwardRequest",
                                    forward,
                                    "domain",
                                    domain,
                                    "types",
                                    typed.get("types"),
                                    "primaryType",
                                    "ForwardRequest",
                                    "forwardDigest",
                                    DmrvnProtocol.digest("ForwardRequest", domain, forward));
                    s.put("sponsored", result);
                    s.put("submissionMode", "SPONSORED");
                    save(key, s);
                    return Json.copy(result);
                });
    }

    /**
     * Records the app's send intent before returning calldata. Subsequent calls return the same
     * transaction.
     */
    public Map<String, Object> prepareSelfPaid(String operationId) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    verifyState(key, s, true);
                    require(
                            !"SPONSORED".equals(s.get("submissionMode")),
                            Code.SUBMISSION_INPUT_CHANGED);
                    if (!s.containsKey("submitFromBlock")) {
                        verifyBeforeSubmission(s);
                        s.put("submissionMode", "SELF_PAID");
                        s.put("submitFromBlock", chain.head());
                        s.put("phase", "BROADCAST_INTENT");
                        save(key, s);
                    }
                    return selfPaid(Json.map(s.get("approved")));
                });
    }

    /**
     * Persists an app signature without broadcasting, for restart or compatible upgrade recovery.
     */
    public Map<String, Object> recordSponsoredSignature(
            String operationId, Map<String, Object> forwardRequest, String userSignature) {
        String key = operationKey(operationId);
        var forward = Json.copy(forwardRequest);
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    require(
                            "SPONSORED".equals(s.get("submissionMode")),
                            Code.OPERATION_NOT_PREPARED);
                    require(!s.containsKey("submitFromBlock"), Code.SUBMISSION_UNRESOLVED);
                    require(
                            Json.hash(forward)
                                    .equals(
                                            Json.hash(
                                                    Json.map(s.get("sponsored"))
                                                            .get("forwardRequest"))),
                            Code.SUBMISSION_INPUT_CHANGED);
                    verifyState(key, s, true);
                    verifyBeforeSubmission(s);
                    String digest =
                            DmrvnProtocol.digest(
                                    "ForwardRequest",
                                    DmrvnProtocol.domain(
                                            config.chainId(), config.forwarderAddress(), true),
                                    forward);
                    require(
                            Crypto.recover(digest, userSignature)
                                    .equals(Crypto.address(Json.str(forward.get("from")))),
                            Code.SIGNATURE_INVALID);
                    require(
                            chain.nonce(Json.str(forward.get("from")), true)
                                    .equals(Crypto.uint(forward.get("nonce"), 256)),
                            Code.NONCE_CONFLICT);
                    persistSignature(key, s, forward, userSignature, digest);
                    return Json.obj(
                            "forwardRequest",
                            Json.copy(forward),
                            "userSignature",
                            userSignature,
                            "forwardDigest",
                            digest,
                            "deployment",
                            Json.copy(Json.map(s.get("deployment"))));
                });
    }

    private void persistSignature(
            String key,
            Map<String, Object> state,
            Map<String, Object> forward,
            String signature,
            String digest) {
        String fingerprint =
                Json.hash(Json.obj("forwardRequest", forward, "userSignature", signature));
        require(
                !state.containsKey("submissionFingerprint")
                        || fingerprint.equals(state.get("submissionFingerprint")),
                Code.SUBMISSION_INPUT_CHANGED);
        state.put("forwardRequest", forward);
        state.put("userSignature", signature);
        state.put("forwardDigest", digest);
        state.put("submissionFingerprint", fingerprint);
        save(key, state);
    }

    /** Verifies the saved app signature and sends at most once; upgrades never regenerate it. */
    public Map<String, Object> submitSponsored(
            String operationId, Map<String, Object> forwardRequest, String userSignature) {
        String key = operationKey(operationId);
        var forward = Json.copy(forwardRequest);
        String fingerprint =
                Json.hash(Json.obj("forwardRequest", forward, "userSignature", userSignature));
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    require(
                            "SPONSORED".equals(s.get("submissionMode"))
                                    && s.containsKey("sponsored"),
                            Code.OPERATION_NOT_PREPARED);
                    require(
                            Json.hash(forward)
                                    .equals(
                                            Json.hash(
                                                    Json.map(s.get("sponsored"))
                                                            .get("forwardRequest"))),
                            Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("submissionFingerprint"))
                        require(
                                fingerprint.equals(s.get("submissionFingerprint")),
                                Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("submitFromBlock")) {
                        var found = resolveLocked(key, s, null);
                        if (found != null) return found;
                        throw new DmrvnException(Code.SUBMISSION_UNRESOLVED);
                    }
                    verifyState(key, s, true);
                    verifyBeforeSubmission(s);
                    String digest =
                            DmrvnProtocol.digest(
                                    "ForwardRequest",
                                    DmrvnProtocol.domain(
                                            config.chainId(), config.forwarderAddress(), true),
                                    forward);
                    require(
                            Crypto.recover(digest, userSignature)
                                    .equals(Crypto.address(Json.str(forward.get("from")))),
                            Code.SIGNATURE_INVALID);
                    require(
                            chain.nonce(Json.str(forward.get("from")), true)
                                    .equals(Crypto.uint(forward.get("nonce"), 256)),
                            Code.NONCE_CONFLICT);
                    var call = DmrvnProtocol.forwardCall(forward, userSignature);
                    require(
                            Boolean.TRUE.equals(
                                    chain.contract(
                                                    DmrvnProtocol.FORWARDER,
                                                    config.forwarderAddress(),
                                                    "verify",
                                                    Map.of("request", call),
                                                    "latest")
                                            .get("")),
                            Code.SIGNATURE_INVALID);
                    persistSignature(key, s, forward, userSignature, digest);
                    return journal.withLock(
                            relayKey(),
                            () -> {
                                var reserved = journal.load(relayKey());
                                require(
                                        reserved == null
                                                || reserved.isEmpty()
                                                || operationId.equals(reserved.get("operationId")),
                                        Code.NONCE_CONFLICT);
                                String sender = Crypto.address(relay.address());
                                String data = DmrvnProtocol.executeCalldata(forward, userSignature);
                                var tx =
                                        Json.obj(
                                                "from",
                                                sender,
                                                "to",
                                                config.forwarderAddress(),
                                                "value",
                                                "0x0",
                                                "data",
                                                data);
                                BigInteger gas =
                                        Chain.number(chain.call("eth_estimateGas", tx))
                                                .multiply(BigInteger.valueOf(130))
                                                .divide(BigInteger.valueOf(100));
                                BigInteger price = Chain.number(chain.call("eth_gasPrice"));
                                BigInteger cost = gas.multiply(price);
                                require(
                                        cost.compareTo(config.maxRelayCostWei()) <= 0,
                                        Code.INSUFFICIENT_FUNDS);
                                require(
                                        Chain.number(
                                                                chain.call(
                                                                        "eth_getBalance",
                                                                        sender,
                                                                        "pending"))
                                                        .compareTo(cost)
                                                >= 0,
                                        Code.INSUFFICIENT_FUNDS);
                                BigInteger nonce =
                                        Chain.number(
                                                chain.call(
                                                        "eth_getTransactionCount",
                                                        sender,
                                                        "pending"));
                                require(
                                        nonce.equals(
                                                Chain.number(
                                                        chain.call(
                                                                "eth_getTransactionCount",
                                                                sender,
                                                                "latest"))),
                                        Code.NONCE_CONFLICT);
                                tx.put("gas", Chain.quantity(gas));
                                tx.put("gasPrice", Chain.quantity(price));
                                tx.put("nonce", Chain.quantity(nonce));
                                chain.call("eth_call", tx, "pending");
                                // Reserve this Relay until receipt reconciliation; another
                                // operation cannot race its account nonce.
                                reserve(journal, relayKey(), operationId);
                                s.put("forwardRequest", forward);
                                s.put("userSignature", userSignature);
                                s.put("forwardDigest", digest);
                                s.put("submissionFingerprint", fingerprint);
                                s.put("submitFromBlock", chain.head());
                                s.put("phase", "BROADCAST_INTENT");
                                s.put("relay", sender);
                                s.put("relayTransaction", tx);
                                s.putIfAbsent(
                                        "relayIdempotencyKey",
                                        Crypto.textHash(
                                                config.deploymentId()
                                                        + ":"
                                                        + operationId
                                                        + ":"
                                                        + fingerprint));
                                save(key, s);
                                try {
                                    String txHash =
                                            relay.sendTransaction(
                                                    config.chainId(),
                                                    Json.copy(tx),
                                                    Json.str(s.get("relayIdempotencyKey")));
                                    s.put("txHash", Crypto.bytes32(txHash));
                                    s.put("phase", "SUBMITTED");
                                    save(key, s);
                                    return Json.obj(
                                            "operationId",
                                            operationId,
                                            "deploymentId",
                                            config.deploymentId(),
                                            "claimId",
                                            s.get("claimId"),
                                            "txHash",
                                            txHash,
                                            "status",
                                            "BROADCAST",
                                            "recovered",
                                            false);
                                } catch (RuntimeException error) {
                                    throw new DmrvnException(Code.SUBMISSION_UNRESOLVED);
                                }
                            });
                });
    }

    /**
     * Confirms the exact receipt, sender, target, calldata, event, nonce and stored Claim. No
     * transaction is sent.
     */
    public Map<String, Object> resolveSubmission(String operationId, String txHash) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    require(s.containsKey("submitFromBlock"), Code.OPERATION_NOT_PREPARED);
                    var result = resolveLocked(key, s, txHash);
                    if (result == null) throw new DmrvnException(Code.SUBMISSION_UNRESOLVED);
                    return result;
                });
    }

    private Map<String, Object> resolveLocked(
            String key, Map<String, Object> s, String suppliedHash) {
        verifyState(key, s, false);
        long head = chain.confirmedHead();
        var a = Json.map(s.get("approved"));
        var request = Json.map(a.get("claimRequest"));
        String id = Json.str(request.get("claimId"));
        String txHash =
                suppliedHash != null ? Crypto.bytes32(suppliedHash) : (String) s.get("txHash");
        if (s.containsKey("txHash") && txHash != null)
            require(
                    txHash.equalsIgnoreCase(Json.str(s.get("txHash"))),
                    Code.SUBMISSION_INPUT_CHANGED);
        var claim = chain.claim(id, head);
        if ("0".equals(String.valueOf(claim.get("status")))) return null;
        for (String field :
                List.of(
                        "partnerId",
                        "activityId",
                        "methodologyId",
                        "methodologyVersion",
                        "evidenceHash",
                        "methodologyHash"))
            require(
                    String.valueOf(request.get(field)).equals(String.valueOf(claim.get(field))),
                    Code.SUBMISSION_INPUT_CHANGED);
        require(
                Crypto.address(Json.str(request.get("beneficiary")))
                        .equals(Crypto.address(Json.str(claim.get("beneficiary")))),
                Code.SUBMISSION_INPUT_CHANGED);
        String signer =
                Crypto.recover(
                        DmrvnProtocol.digest(
                                "ClaimRequest",
                                DmrvnProtocol.domain(
                                        config.chainId(), config.claimAddress(), false),
                                request),
                        Json.str(a.get("approvalSignature")));
        require(
                signer.equals(Crypto.address(Json.str(claim.get("approver"))))
                        && DmrvnProtocol.evidenceLocationHash(
                                        Json.map(request.get("evidenceLocation")))
                                .equals(claim.get("evidenceLocationHash"))
                        && Json.hash(request.get("evidenceLocation"))
                                .equals(Json.hash(claim.get("evidenceLocation"))),
                Code.SUBMISSION_INPUT_CHANGED);
        DmrvnProtocol.verifyProvenance(
                Json.map(s.get("evidence")),
                Json.str(claim.get("evidenceHash")),
                Json.str(claim.get("approver")));
        if (txHash == null)
            txHash =
                    chain.findTransaction(
                            "MrvClaimRequested",
                            id,
                            ((Number) s.get("submitFromBlock")).longValue(),
                            head,
                            "nonce",
                            Json.str(request.get("nonce")));
        if (txHash == null) return null;
        var receipt = chain.receipt(txHash, head);
        if (receipt == null) return null;
        require(
                Chain.number(receipt.get("status")).equals(BigInteger.ONE),
                Code.SUBMISSION_INPUT_CHANGED);
        Object txObject = chain.call("eth_getTransactionByHash", txHash);
        if (txObject == null) return null;
        var tx = Json.map(txObject);
        require(
                txHash.equalsIgnoreCase(Json.str(tx.get("hash")))
                        && Objects.equals(tx.get("blockHash"), receipt.get("blockHash")),
                Code.SUBMISSION_INPUT_CHANGED);
        var event = chain.event("MrvClaimRequested", receipt, id);
        require(
                event != null
                        && String.valueOf(event.get("nonce"))
                                .equals(String.valueOf(request.get("nonce"))),
                Code.SUBMISSION_INPUT_CHANGED);
        for (String field :
                List.of(
                        "beneficiary",
                        "partnerId",
                        "activityId",
                        "methodologyId",
                        "methodologyVersion",
                        "methodologyHash",
                        "evidenceHash"))
            require(
                    String.valueOf(event.get(field))
                            .equalsIgnoreCase(String.valueOf(request.get(field))),
                    Code.SUBMISSION_INPUT_CHANGED);
        boolean sponsored = "SPONSORED".equals(s.get("submissionMode"));
        String target = sponsored ? config.forwarderAddress() : config.claimAddress(),
                sender =
                        sponsored ? Json.str(s.get("relay")) : Json.str(request.get("beneficiary"));
        String data =
                sponsored
                        ? DmrvnProtocol.executeCalldata(
                                Json.map(s.get("forwardRequest")), Json.str(s.get("userSignature")))
                        : DmrvnProtocol.submitCalldata(a);
        require(
                target.equalsIgnoreCase(Json.str(receipt.get("to")))
                        && target.equalsIgnoreCase(Json.str(tx.get("to")))
                        && sender.equalsIgnoreCase(Json.str(receipt.get("from")))
                        && sender.equalsIgnoreCase(Json.str(tx.get("from")))
                        && data.equalsIgnoreCase(Json.str(tx.get("input")))
                        && Chain.number(tx.get("value")).signum() == 0,
                Code.SUBMISSION_INPUT_CHANGED);
        if (sponsored) {
            boolean found = false;
            for (Object raw : Json.list(receipt.get("logs"))) {
                var log = Json.map(raw);
                if (!config.forwarderAddress().equalsIgnoreCase(String.valueOf(log.get("address"))))
                    continue;
                var topics = Json.list(log.get("topics"));
                if (topics.isEmpty()
                        || !DmrvnProtocol.FORWARDER
                                .topic("ExecutedForwardRequest")
                                .equals(topics.get(0))) continue;
                var e = DmrvnProtocol.FORWARDER.decodeEvent("ExecutedForwardRequest", log);
                var f = Json.map(s.get("forwardRequest"));
                if (Json.str(e.get("signer")).equalsIgnoreCase(Json.str(f.get("from")))
                        && String.valueOf(e.get("nonce")).equals(f.get("nonce"))
                        && Boolean.TRUE.equals(e.get("success"))) found = true;
            }
            require(found, Code.SUBMISSION_INPUT_CHANGED);
        }
        s.put("txHash", txHash);
        s.put("receipt", receipt);
        s.put("phase", "SUBMITTED");
        s.put("submissionStatus", "CONFIRMED");
        save(key, s);
        release(
                beneficiaryKey(Json.str(request.get("beneficiary"))),
                Json.str(s.get("operationId")));
        if (sponsored) release(relayKey(), Json.str(s.get("operationId")));
        return Json.obj(
                "operationId",
                s.get("operationId"),
                "deploymentId",
                config.deploymentId(),
                "deployment",
                s.get("deployment"),
                "verifiedMetadata",
                s.get("verifiedMetadata"),
                "claimId",
                id,
                "txHash",
                txHash,
                "receipt",
                receipt,
                "claim",
                claim,
                "status",
                "CONFIRMED",
                "recovered",
                true);
    }

    private void release(String key, String operationId) {
        journal.withLock(
                key,
                () -> {
                    var r = journal.load(key);
                    if (r != null && operationId.equals(r.get("operationId")))
                        journal.store(key, Map.of());
                    return null;
                });
    }

    public Map<String, Object> operation(String operationId) {
        return Json.copy(required(operationKey(operationId)));
    }

    /**
     * Saves the independent reader's observation, including report errors, in the partner journal.
     */
    public Map<String, Object> readResult(
            String operationId,
            DmrvnReader reader,
            Long fromBlock,
            String reportTxHash,
            boolean waitTimedOut) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = required(key);
                    verifyState(key, s, false);
                    String hash =
                            reportTxHash != null ? reportTxHash : (String) s.get("reportTxHash");
                    Map<String, Object> result;
                    try {
                        result =
                                reader.readResult(
                                        Json.str(s.get("claimId")),
                                        fromBlock,
                                        hash,
                                        waitTimedOut,
                                        null);
                    } catch (DmrvnException e) {
                        if (e.code() == Code.DEPLOYMENT_NOT_READY
                                || e.code() == Code.UNAPPROVED_IMPLEMENTATION) {
                            s.remove("verifiedMetadata");
                            s.put("ready", false);
                            s.put("deploymentError", e.code().name());
                            save(key, s);
                        }
                        throw e;
                    }
                    require(
                            config.deploymentId().equals(result.get("deploymentId")),
                            Code.WRONG_CHAIN);
                    var stored = Json.map(result.get("claim"));
                    if (!"0".equals(String.valueOf(stored.get("status")))) {
                        DmrvnProtocol.verifyProvenance(
                                Json.map(s.get("evidence")),
                                Json.str(stored.get("evidenceHash")),
                                Json.str(stored.get("approver")));
                        result.put("provenanceVerified", true);
                    }
                    s.put("verifiedMetadata", result.get("verifiedMetadata"));
                    result.put("deployment", Json.copy(Json.map(s.get("deployment"))));
                    s.put("result", result);
                    if (result.containsKey("reportTxHash"))
                        s.put("reportTxHash", result.get("reportTxHash"));
                    save(key, s);
                    return result;
                });
    }
}
