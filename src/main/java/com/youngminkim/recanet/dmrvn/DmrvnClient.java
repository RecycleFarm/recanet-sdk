package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import com.youngminkim.recanet.UserWalletClient;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import java.math.BigInteger;
import java.util.*;
import java.util.function.Supplier;

/** Partner-side DMRVN v7 submission. Durable records and recovery belong to the consumer. */
public final class DmrvnClient {
    private final DmrvnConfig config;
    private final Chain chain;
    private final EvmSigner operator;
    private final EvmRpc rpc;
    private final OperationJournal suppliedJournal;
    private final GreenfieldStorage storage;
    private final DeclaredMethodology methodology;
    private final OperationJournal journal;
    private final SdkTelemetry telemetry;
    private final Map<String, Map<String, Object>> observations = new java.util.concurrent.ConcurrentHashMap<>();

    /** One operating wallet signs provenance/approval and pays Relay gas. No durable journal needed. */
    public DmrvnClient(DmrvnConfig config, EvmRpc rpc, EvmSigner operator,
                       GreenfieldStorage storage, DeclaredMethodology methodology) {
        this(config, rpc, operator, storage, methodology, null);
    }

    /** Optional consumer-owned journal; its presence does not guarantee recovery. */
    public DmrvnClient(DmrvnConfig config, EvmRpc rpc, EvmSigner operator,
                       GreenfieldStorage storage, DeclaredMethodology methodology,
                       OperationJournal journal) {
        this(config, rpc, operator, storage, methodology, journal, SdkTelemetry.local());
    }

    public DmrvnClient(DmrvnConfig config, EvmRpc rpc, EvmSigner operator,
                       GreenfieldStorage storage, DeclaredMethodology methodology,
                       OperationJournal journal, SdkTelemetry telemetry) {
        this.config = Objects.requireNonNull(config);
        this.telemetry = Objects.requireNonNull(telemetry, "telemetry");
        this.rpc = telemetry.instrumentRpc(Objects.requireNonNull(rpc));
        this.chain = new Chain(config, this.rpc);
        this.operator = telemetry.instrumentSigner(Objects.requireNonNull(operator));
        this.storage = telemetry.instrumentStorage(Objects.requireNonNull(storage));
        this.methodology = Objects.requireNonNull(methodology);
        this.suppliedJournal = journal;
        this.journal = journal == null ? new MemoryOperationJournal() : journal;
        Crypto.address(operator.address(), "operator.address");
        Crypto.address(storage.address(), "storage.address");
        require(config.greenfieldChainId().equals(storage.chainId()), Code.WRONG_CHAIN);
    }

    /** Migration overload: different approval/Relay wallets are rejected before any side effects. */
    @Deprecated
    public DmrvnClient(DmrvnConfig config, EvmRpc rpc, EvmSigner approver, EvmSigner relay,
                       GreenfieldStorage storage, DeclaredMethodology methodology,
                       OperationJournal journal) {
        this(config, rpc, sameOperator(approver, relay), storage, methodology, journal);
    }

    private static EvmSigner sameOperator(EvmSigner approver, EvmSigner relay) {
        require(approver != null && relay != null
                && Crypto.address(approver.address(), "approver.address")
                        .equals(Crypto.address(relay.address(), "relay.address")),
                Code.INVALID_INPUT, "approver/relay", "must specify the same non-null operating wallet");
        return approver;
    }

    /**
     * Performs reads only. Storage write/read and validator access require an actual object test.
     */
    public Map<String, Object> preflight() {
        return telemetry.observe("DmrvnClient.preflight", null,
                () -> preflightImpl());
    }

    private Map<String, Object> preflightImpl() {
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
                    chain.verifyApprover(operator.address());
                    return true;
                });
        check(
                checks,
                "methodology",
                () -> {
                    methodology.verifyActive();
                    return true;
                });
        check(checks, "evidenceContract", () -> {
            methodology.requireExplicitEvidenceVersion();
            return true;
        });
        check(
                checks,
                "relayBalanceWei",
                () ->
                        Chain.number(
                                        chain.call(
                                                "eth_getBalance",
                                                Crypto.address(operator.address()),
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
                Json.map(checks.get("deployment"), "deployment").get("value"),
                "approver",
                Crypto.address(operator.address()),
                "relay",
                Crypto.address(operator.address()),
                "storageSigner",
                Crypto.address(storage.address()),
                "checks",
                checks);
    }

    private void check(Map<String, Object> result, String name, Supplier<Object> fn) {
        try {
            result.put(name, Json.obj("ok", true, "value", telemetry.step("DmrvnClient.preflight." + name, fn)));
        } catch (DmrvnException e) {
            result.put(name, Json.obj("ok", false, "code", e.code().name(), "message", e.getMessage()));
        }
    }

    private static String operationKey(String id) {
        require(id != null && id.matches("[A-Za-z0-9:_-]{1,128}"), Code.INVALID_INPUT,
                "operationId", "must contain 1 to 128 letters, digits, colons, underscores or hyphens");
        return "operation:" + id;
    }

    private String beneficiaryKey(String address) {
        return "claim-nonce:" + config.deploymentId() + ":" + Crypto.address(address);
    }

    private String relayKey() {
        return "relay-nonce:" + config.chainId() + ":" + Crypto.address(operator.address());
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
                        Crypto.address(operator.address()),
                        "relay",
                        Crypto.address(operator.address()),
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
        logKnownState(s);
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
                config.deployment().assertCompatible(Json.map(state.get("deployment"), "deployment"));
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
        var approved = Json.map(state.get("approved"), "approved");
        var request = Json.map(approved.get("claimRequest"), "claimRequest");
        String signer =
                Crypto.recover(
                        DmrvnProtocol.digest(
                                "ClaimRequest",
                                DmrvnProtocol.domain(
                                        config.chainId(), config.claimAddress(), false),
                                request),
                        Json.str(approved.get("approvalSignature"), "approvalSignature"));
        DmrvnProtocol.verifyProvenance(
                Json.map(state.get("evidence"), "evidence"), Json.str(request.get("evidenceHash"), "evidenceHash"), signer);
        chain.verifyApprover(signer);
        validateCurrent(request);
    }

    private Map<String, Object> approved(String key) {
        var s = required(key);
        require(s.containsKey("approved"), Code.OPERATION_NOT_PREPARED);
        return s;
    }

    private void save(String key, Map<String, Object> state) {
        logKnownState(state);
        // Preserve observed facts even if the consumer's optional journal write fails.
        observations.put(key, Json.copy(state));
        journal.store(key, Json.copy(state));
    }

    private void logKnownState(Map<String, Object> state) {
        Object phase = state.get("phase");
        if (phase instanceof String name) {
            try { telemetry.checkpoint(SdkTelemetry.State.valueOf(name)); }
            catch (IllegalArgumentException ignored) { /* unknown journal fields are not logged */ }
        }
        if ("CONFIRMED".equals(state.get("submissionStatus"))) {
            telemetry.submissionConfirmed();
            telemetry.checkpoint(SdkTelemetry.State.SUBMISSION_CONFIRMED);
        }
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
        return telemetry.observe("DmrvnClient.prepareEvidence", operationId,
                () -> prepareEvidenceImpl(operationId, claimId, beneficiary, objectName, evidenceBody));
    }

    private Map<String, Object> prepareEvidenceImpl(
            String operationId,
            String claimId,
            String beneficiary,
            String objectName,
            Map<String, Object> evidenceBody) {
        String key = operationKey(operationId),
                id = Crypto.bytes32(claimId, "claimId"),
                user = Crypto.address(beneficiary, "beneficiary");
        config.checkObject(objectName);
        var body = Json.copy(evidenceBody, "evidenceBody");
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
                                Crypto.address(operator.address()),
                                "approver",
                                Crypto.address(operator.address()),
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
                    chain.verifyApprover(operator.address());
                    methodology.verifyActive();
                    if (!state.containsKey("evidence")) {
                        String message = "DMRVN v4 source:" + Json.hash(body);
                        String signature = operator.signMessage(message);
                        require(
                                Crypto.recover(Crypto.messageDigest(message), signature)
                                        .equals(Crypto.address(operator.address())),
                                Code.SIGNATURE_INVALID);
                        var evidence = Json.copy(body);
                        evidence.put(
                                "provenance",
                                Json.obj(
                                        "signer",
                                        operator.address(),
                                        "sourceSignature",
                                        signature));
                        require(Json.bytes(evidence).length <= 1024 * 1024, Code.INVALID_INPUT,
                                "evidence", "serialized Evidence including provenance must not exceed 1048576 bytes");
                        state.put("evidence", evidence);
                        state.put("phase", "EVIDENCE_SIGNED");
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
                    // New objects are created explicitly. A failed HEAD must never be interpreted
                    // as permission to create, and a failed create must not trigger recovery.
                    if (!state.containsKey("createIntent") && !state.containsKey("createTxHash")) {
                        state.put("createIntent", true);
                        save(key, state);
                        String txHash = storage.create(location, bytes);
                        require(
                                txHash != null && !txHash.isBlank(),
                                Code.STORAGE_CREATE_UNRESOLVED);
                        state.put("createTxHash", txHash);
                        state.put("phase", "EVIDENCE_CREATE_BROADCAST");
                        save(key, state);
                    }
                    require(state.get("createTxHash") instanceof String, Code.STORAGE_CREATE_UNRESOLVED);
                    var head = storage.head(location);
                    if (head.exists()) {
                        state.put("objectExists", true);
                        save(key, state);
                    }
                    if (!head.sealed()) {
                        require(
                                state.get("createTxHash") instanceof String,
                                Code.STORAGE_CREATE_UNRESOLVED);
                        storage.upload(location, bytes, Json.str(state.get("createTxHash"), "createTxHash"));
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
                    state.put("phase", "EVIDENCE_SEALED");
                    save(key, state);
                    return Json.copy(state);
                });
    }

    /**
     * Reconciles a lost CreateObject response using a verified original transaction; never creates
     * again.
     */
    public void recoverCreateTransaction(String operationId, String createTxHash) {
        telemetry.observeVoid("DmrvnClient.recoverCreateTransaction", operationId,
                () -> recoverCreateTransactionImpl(operationId, createTxHash));
    }

    private void recoverCreateTransactionImpl(String operationId, String createTxHash) {
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
                                    Json.map(s.get("evidenceLocation"), "evidenceLocation"), createTxHash),
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
        return telemetry.observe("DmrvnClient.approveClaim", operationId,
                () -> approveClaimImpl(operationId));
    }

    private Map<String, Object> approveClaimImpl(String operationId) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = required(key);
                    require(s.containsKey("upload"), Code.OPERATION_NOT_PREPARED);
                    verifyState(key, s, true);
                    if (s.containsKey("approved")) return Json.copy(Json.map(s.get("approved"), "approved"));
                    chain.verifyApprover(operator.address());
                    DmrvnProtocol.verifyProvenance(
                            Json.map(s.get("evidence"), "evidence"),
                            Json.hash(s.get("evidence")),
                            operator.address());
                    methodology.verifyActive();
                    var location = Json.map(s.get("evidenceLocation"), "evidenceLocation");
                    require(storage.head(location).sealed(), Code.OBJECT_UNSEALED);
                    require(
                            Arrays.equals(Json.bytes(s.get("evidence")), storage.read(location)),
                            Code.STORAGE_MISMATCH);
                    String user = Json.str(s.get("beneficiary"), "beneficiary");
                    methodology.validate(Json.map(s.get("body"), "body"), config.partnerId(), user);
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
                                var request = Json.map(s.get("claimRequest"), "claimRequest");
                                validateCurrent(request);
                                var domain =
                                        DmrvnProtocol.domain(
                                                config.chainId(), config.claimAddress(), false);
                                String digest =
                                        DmrvnProtocol.digest("ClaimRequest", domain, request);
                                String signature =
                                        operator.signTypedData(
                                                DmrvnProtocol.typedData(
                                                        "ClaimRequest", domain, request));
                                require(
                                        Crypto.recover(digest, signature)
                                                .equals(Crypto.address(operator.address())),
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

    /** Uploads evidence and signs partner approval; does not submit an on-chain Claim. */
    public Map<String, Object> prepare(
            String operationId,
            String claimId,
            String beneficiary,
            String objectName,
            Map<String, Object> evidenceBody) {
        return telemetry.observe("DmrvnClient.prepare", operationId,
                () -> prepareImpl(operationId, claimId, beneficiary, objectName, evidenceBody));
    }

    private Map<String, Object> prepareImpl(
            String operationId,
            String claimId,
            String beneficiary,
            String objectName,
            Map<String, Object> evidenceBody) {
        prepareEvidence(operationId, claimId, beneficiary, objectName, evidenceBody);
        return approveClaim(operationId);
    }

    /**
     * One call: authorized wallet lookup/creation, Evidence construction, Greenfield seal/read,
     * approval, beneficiary signature, Relay send and one receipt/Claim confirmation check.
     * Each invocation is independent: no automatic retries, restart recovery or deduplication.
     * Errors propagate to the caller unchanged; no FAILED/UNKNOWN outcome is synthesized.
     * Only successful confirmation returns a result; no reusable signatures are exposed.
     */
    public Map<String, Object> submitActivity(BeneficiaryWallets wallets, ActivityRequest request) {
        String operationId = UUID.randomUUID().toString();
        return telemetry.observe("DmrvnClient.submitActivity", operationId,
                () -> submitActivityImpl(wallets, request, operationId));
    }

    private Map<String, Object> submitActivityImpl(
            BeneficiaryWallets wallets, ActivityRequest request, String operationId) {
        Objects.requireNonNull(wallets);
        Objects.requireNonNull(request);
        String claimId = request.claimId() == null
                ? Crypto.textHash(config.deploymentId() + ":" + operationId) : request.claimId();
        String objectName = request.objectName() == null
                ? config.objectPrefix() + "activities/" + methodology.activityId() + "/"
                        + operationId + "/evidence.json" : request.objectName();
        // Volatile state is call-scoped. A supplied journal records steps for the consumer only.
        var run = new DmrvnClient(config, rpc, operator, storage, methodology, suppliedJournal, telemetry);
        Map<String, Object> known = Json.obj("deploymentId", config.deploymentId(),
                "chainId", config.chainId(), "claimAddress", config.claimAddress(),
                "claimId", claimId, "operationId", operationId, "sourceEventId", request.sourceEventId());
        var requested = Json.obj("evidenceLocation", Json.obj("storageType", 1,
                "chainId", config.greenfieldChainId(), "bucketName", config.bucketName(),
                "objectName", objectName));
        config.checkObject(objectName);
        methodology.requireExplicitEvidenceVersion();
        EvmSigner user = telemetry.step("BeneficiaryWallets.getOrCreateSigner", () -> Objects.requireNonNull(
                wallets.getOrCreateSigner(config.partnerId(), request.userId())));
        known.put("beneficiary", Crypto.address(user.address()));
        var body = telemetry.step("Evidence.build", () -> methodology.evidenceBody(config.partnerId(), user.address(),
                request.sourceEventId(), request.inputs()));
        var sent = run.submitActivity(user, operationId, claimId, objectName, body, request.gas());
        if (!"CONFIRMED".equals(sent.get("status"))) {
            sent = run.resolveSubmission(operationId, (String) sent.get("txHash"));
        }
        var state = run.observations.get(operationKey(operationId));
        addConfirmedFacts(known, state);
        return Json.obj("outcome", "CONFIRMED", "lastConfirmedStage", "SUBMISSION_CONFIRMED",
                "confirmed", known, "requested", requested);
    }

    private static void addConfirmedFacts(Map<String, Object> known, Map<String, Object> state) {
        if (state.containsKey("evidence")) known.put("evidenceHash", Json.hash(state.get("evidence")));
        if (state.containsKey("createTxHash")) known.put("createTxHash", state.get("createTxHash"));
        if (Boolean.TRUE.equals(state.get("objectExists")) || state.containsKey("upload"))
            known.put("evidenceLocation", Json.copy(Json.map(state.get("evidenceLocation"), "evidenceLocation")));
        if (state.containsKey("upload")) known.put("storageStatus", "SEALED");
        if (state.containsKey("submitFromBlock")) known.put("submissionFromBlock", state.get("submitFromBlock"));
        if (state.containsKey("txHash")) known.put("txHash", state.get("txHash"));
        if (state.containsKey("receipt")) known.put("receipt", Json.copy(Json.map(state.get("receipt"), "receipt")));
        if (state.containsKey("chainStatus")) known.put("chainStatus", state.get("chainStatus"));
    }

    /**
     * Uploads evidence, approves, signs with the member wallet and submits a sponsored Claim.
     * The service must authenticate/authorize userId. The existing member wallet must match the
     * evidence beneficiary. No app signature or signature file is needed.
     * Returns BROADCAST on initial submission, not final DMRVN validation; use resolveSubmission
     * and readResult for confirmation and the final report. Reuse the same operationId and inputs
     * to recover without resending an unresolved transaction.
     */
    public Map<String, Object> submitActivity(
            UserWalletClient wallets,
            String userId,
            String operationId,
            String claimId,
            String objectName,
            Map<String, Object> evidenceBody,
            String gas) {
        return telemetry.observe("DmrvnClient.submitActivity", operationId,
                () -> submitActivityImpl(wallets, userId, operationId, claimId, objectName, evidenceBody, gas));
    }

    private Map<String, Object> submitActivityImpl(
            UserWalletClient wallets,
            String userId,
            String operationId,
            String claimId,
            String objectName,
            Map<String, Object> evidenceBody,
            String gas) {
        return submitActivity(
                Objects.requireNonNull(wallets).signerFor(userId),
                operationId, claimId, objectName, evidenceBody, gas);
    }

    /** Same workflow with an explicitly supplied beneficiary signer, e.g. a remote wallet adapter. */
    public Map<String, Object> submitActivity(
            EvmSigner userSigner,
            String operationId,
            String claimId,
            String objectName,
            Map<String, Object> evidenceBody,
            String gas) {
        return telemetry.observe("DmrvnClient.submitActivity", operationId,
                () -> submitActivityImpl(telemetry.instrumentSigner(userSigner), operationId, claimId, objectName, evidenceBody, gas));
    }

    private Map<String, Object> submitActivityImpl(
            EvmSigner userSigner,
            String operationId,
            String claimId,
            String objectName,
            Map<String, Object> evidenceBody,
            String gas) {
        Objects.requireNonNull(userSigner);
        String key = operationKey(operationId);
        BigInteger gasValue = Crypto.uint(gas, 256, "gas");
        require(
                gasValue.compareTo(BigInteger.valueOf(100000)) >= 0
                        && gasValue.compareTo(BigInteger.valueOf(2000000)) <= 0,
                Code.INVALID_INPUT, "gas", "must be between 100000 and 2000000 inclusive");
        var body = Json.copy(evidenceBody, "evidenceBody");
        String beneficiary = Crypto.address(userSigner.address(), "beneficiary");
        // A separate workflow lock serializes signing across composed calls without recursively
        // acquiring the operation lock used by each existing durable step.
        return journal.withLock(
                "activity:" + key,
                () -> {
                    var state = prepareEvidence(
                            operationId, claimId, beneficiary, objectName, body);
                    Map<String, Object> signingRequest;
                    if (state.containsKey("submitFromBlock")) {
                        // Do not require a still-valid approval or generate a new signature after
                        // broadcast intent. Only reconcile the exact original submission.
                        require("SPONSORED".equals(state.get("submissionMode")),
                                Code.SUBMISSION_INPUT_CHANGED);
                        signingRequest = Json.map(state.get("sponsored"), "sponsored");
                        require(gas.equals(Json.map(signingRequest.get("forwardRequest"), "forwardRequest").get("gas")),
                                Code.SUBMISSION_INPUT_CHANGED);
                    } else {
                        approveClaim(operationId);
                        signingRequest = prepareSponsored(operationId, gas);
                    }
                    var forward = Json.map(signingRequest.get("forwardRequest"), "forwardRequest");
                    String signature = (String) state.get("userSignature");
                    if (signature == null) {
                        require(!state.containsKey("submitFromBlock"), Code.SUBMISSION_UNRESOLVED);
                        signature = userSigner.signTypedData(
                                DmrvnProtocol.typedData(
                                        "ForwardRequest", Json.map(signingRequest.get("domain"), "domain"), forward));
                        recordSponsoredSignature(operationId, forward, signature);
                    }
                    return submitSponsored(operationId, forward, signature);
                });
    }

    private void validateCurrent(Map<String, Object> request) {
        require(
                Crypto.uint(request.get("deadline"), 64, "deadline")
                                .compareTo(BigInteger.valueOf(chain.timestamp()))
                        > 0,
                Code.REQUEST_EXPIRED);
        require(
                chain.nonce(Json.str(request.get("beneficiary"), "beneficiary"), false)
                        .equals(Crypto.uint(request.get("nonce"), 256, "nonce")),
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
        return telemetry.observe("DmrvnClient.prepareSponsored", operationId,
                () -> prepareSponsoredImpl(operationId, gas));
    }

    private Map<String, Object> prepareSponsoredImpl(String operationId, String gas) {
        String key = operationKey(operationId);
        BigInteger gasValue = Crypto.uint(gas, 256, "gas");
        require(
                gasValue.compareTo(BigInteger.valueOf(100000)) >= 0
                        && gasValue.compareTo(BigInteger.valueOf(2000000)) <= 0,
                Code.INVALID_INPUT, "gas", "must be between 100000 and 2000000 inclusive");
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    verifyState(key, s, true);
                    require(
                            !"SELF_PAID".equals(s.get("submissionMode")),
                            Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("sponsored")) {
                        var existing = Json.map(s.get("sponsored"), "sponsored");
                        require(
                                gas.equals(Json.map(existing.get("forwardRequest"), "forwardRequest").get("gas")),
                                Code.SUBMISSION_INPUT_CHANGED);
                        return Json.copy(existing);
                    }
                    var a = Json.map(s.get("approved"), "approved");
                    var request = Json.map(a.get("claimRequest"), "claimRequest");
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
                                    chain.nonce(Json.str(request.get("beneficiary"), "beneficiary"), true)
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
        return telemetry.observe("DmrvnClient.prepareSelfPaid", operationId,
                () -> prepareSelfPaidImpl(operationId));
    }

    private Map<String, Object> prepareSelfPaidImpl(String operationId) {
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
                    return selfPaid(Json.map(s.get("approved"), "approved"));
                });
    }

    /**
     * Persists an app signature without broadcasting, for restart or compatible upgrade recovery.
     */
    public Map<String, Object> recordSponsoredSignature(
            String operationId, Map<String, Object> forwardRequest, String userSignature) {
        return telemetry.observe("DmrvnClient.recordSponsoredSignature", operationId,
                () -> recordSponsoredSignatureImpl(operationId, forwardRequest, userSignature));
    }

    private Map<String, Object> recordSponsoredSignatureImpl(
            String operationId, Map<String, Object> forwardRequest, String userSignature) {
        String key = operationKey(operationId);
        var forward = Json.copy(forwardRequest, "forwardRequest");
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
                                                    Json.map(s.get("sponsored"), "sponsored")
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
                                    .equals(Crypto.address(Json.str(forward.get("from"), "from"), "from")),
                            Code.SIGNATURE_INVALID);
                    require(
                            chain.nonce(Json.str(forward.get("from"), "from"), true)
                                    .equals(Crypto.uint(forward.get("nonce"), 256, "nonce")),
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
                            Json.copy(Json.map(s.get("deployment"), "deployment")));
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
        return telemetry.observe("DmrvnClient.submitSponsored", operationId,
                () -> submitSponsoredImpl(operationId, forwardRequest, userSignature));
    }

    private Map<String, Object> submitSponsoredImpl(
            String operationId, Map<String, Object> forwardRequest, String userSignature) {
        String key = operationKey(operationId);
        var forward = Json.copy(forwardRequest, "forwardRequest");
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
                                                    Json.map(s.get("sponsored"), "sponsored")
                                                            .get("forwardRequest"))),
                            Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("submissionFingerprint"))
                        require(
                                fingerprint.equals(s.get("submissionFingerprint")),
                                Code.SUBMISSION_INPUT_CHANGED);
                    if (s.containsKey("submitFromBlock")) {
                        throw new DmrvnException(Code.SUBMISSION_UNRESOLVED,
                                "SUBMISSION_UNRESOLVED: submission intent already exists; use resolveSubmission explicitly to inspect the existing transaction");
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
                                    .equals(Crypto.address(Json.str(forward.get("from"), "from"), "from")),
                            Code.SIGNATURE_INVALID);
                    require(
                            chain.nonce(Json.str(forward.get("from"), "from"), true)
                                    .equals(Crypto.uint(forward.get("nonce"), 256, "nonce")),
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
                                String sender = Crypto.address(operator.address());
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
                                String txHash =
                                        operator.sendTransaction(
                                                config.chainId(),
                                                Json.copy(tx),
                                                Json.str(s.get("relayIdempotencyKey"), "relayIdempotencyKey"));
                                s.put("txHash", Crypto.bytes32(txHash, "txHash"));
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
                            });
                });
    }

    /**
     * Confirms the exact receipt, sender, target, calldata, event, nonce and stored Claim. No
     * transaction is sent.
     */
    public Map<String, Object> resolveSubmission(String operationId, String txHash) {
        return telemetry.observe("DmrvnClient.resolveSubmission", operationId,
                () -> resolveSubmissionImpl(operationId, txHash));
    }

    private Map<String, Object> resolveSubmissionImpl(String operationId, String txHash) {
        String key = operationKey(operationId);
        return journal.withLock(
                key,
                () -> {
                    var s = approved(key);
                    require(s.containsKey("submitFromBlock"), Code.OPERATION_NOT_PREPARED);
                    var result = resolveLocked(key, s, txHash);
                    if (result == null) throw new DmrvnException(Code.SUBMISSION_UNRESOLVED,
                            "SUBMISSION_UNRESOLVED: Claim, transaction or receipt is not yet confirmed; automatic polling is disabled");
                    return result;
                });
    }

    private Map<String, Object> resolveLocked(
            String key, Map<String, Object> s, String suppliedHash) {
        verifyState(key, s, false);
        long head = chain.confirmedHead();
        var a = Json.map(s.get("approved"), "approved");
        var request = Json.map(a.get("claimRequest"), "claimRequest");
        String id = Json.str(request.get("claimId"), "claimId");
        String txHash =
                suppliedHash != null ? Crypto.bytes32(suppliedHash, "txHash") : (String) s.get("txHash");
        if (s.containsKey("txHash") && txHash != null)
            require(
                    txHash.equalsIgnoreCase(Json.str(s.get("txHash"), "txHash")),
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
                Crypto.address(Json.str(request.get("beneficiary"), "beneficiary"), "beneficiary")
                        .equals(Crypto.address(Json.str(claim.get("beneficiary"), "beneficiary"), "beneficiary")),
                Code.SUBMISSION_INPUT_CHANGED);
        String signer =
                Crypto.recover(
                        DmrvnProtocol.digest(
                                "ClaimRequest",
                                DmrvnProtocol.domain(
                                        config.chainId(), config.claimAddress(), false),
                                request),
                        Json.str(a.get("approvalSignature"), "approvalSignature"));
        require(
                signer.equals(Crypto.address(Json.str(claim.get("approver"), "approver"), "approver"))
                        && DmrvnProtocol.evidenceLocationHash(
                                        Json.map(request.get("evidenceLocation"), "evidenceLocation"))
                                .equals(claim.get("evidenceLocationHash"))
                        && Json.hash(request.get("evidenceLocation"))
                                .equals(Json.hash(claim.get("evidenceLocation"))),
                Code.SUBMISSION_INPUT_CHANGED);
        DmrvnProtocol.verifyProvenance(
                Json.map(s.get("evidence"), "evidence"),
                Json.str(claim.get("evidenceHash"), "evidenceHash"),
                Json.str(claim.get("approver"), "approver"));
        if (txHash == null)
            txHash =
                    chain.findTransaction(
                            "MrvClaimRequested",
                            id,
                            ((Number) s.get("submitFromBlock")).longValue(),
                            head,
                            "nonce",
                            Json.str(request.get("nonce"), "nonce"));
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
                txHash.equalsIgnoreCase(Json.str(tx.get("hash"), "hash"))
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
                        sponsored ? Json.str(s.get("relay"), "relay") : Json.str(request.get("beneficiary"), "beneficiary");
        String data =
                sponsored
                        ? DmrvnProtocol.executeCalldata(
                                Json.map(s.get("forwardRequest"), "forwardRequest"), Json.str(s.get("userSignature"), "userSignature"))
                        : DmrvnProtocol.submitCalldata(a);
        require(
                target.equalsIgnoreCase(Json.str(receipt.get("to"), "to"))
                        && target.equalsIgnoreCase(Json.str(tx.get("to"), "to"))
                        && sender.equalsIgnoreCase(Json.str(receipt.get("from"), "from"))
                        && sender.equalsIgnoreCase(Json.str(tx.get("from"), "from"))
                        && data.equalsIgnoreCase(Json.str(tx.get("input"), "input"))
                        && Chain.number(tx.get("value")).signum() == 0,
                Code.SUBMISSION_INPUT_CHANGED);
        if (sponsored) {
            boolean found = false;
            for (Object raw : Json.list(receipt.get("logs"), "logs")) {
                var log = Json.map(raw);
                if (!config.forwarderAddress().equalsIgnoreCase(String.valueOf(log.get("address"))))
                    continue;
                var topics = Json.list(log.get("topics"), "topics");
                if (topics.isEmpty()
                        || !DmrvnProtocol.FORWARDER
                                .topic("ExecutedForwardRequest")
                                .equals(topics.get(0))) continue;
                var e = DmrvnProtocol.FORWARDER.decodeEvent("ExecutedForwardRequest", log);
                var f = Json.map(s.get("forwardRequest"), "forwardRequest");
                if (Json.str(e.get("signer"), "signer").equalsIgnoreCase(Json.str(f.get("from"), "from"))
                        && String.valueOf(e.get("nonce")).equals(f.get("nonce"))
                        && Boolean.TRUE.equals(e.get("success"))) found = true;
            }
            require(found, Code.SUBMISSION_INPUT_CHANGED);
        }
        s.put("txHash", txHash);
        s.put("receipt", receipt);
        s.put("phase", "SUBMITTED");
        s.put("submissionStatus", "CONFIRMED");
        int status = Crypto.uint(claim.get("status"), 8, "status").intValueExact();
        require(status >= 1 && status <= 4, Code.SUBMISSION_INPUT_CHANGED);
        s.put("chainStatus", List.of("NONE", "PENDING", "VALID", "INVALID", "REVOKED").get(status));
        save(key, s);
        release(
                beneficiaryKey(Json.str(request.get("beneficiary"), "beneficiary")),
                Json.str(s.get("operationId"), "operationId"));
        if (sponsored) release(relayKey(), Json.str(s.get("operationId"), "operationId"));
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
        return telemetry.observe("DmrvnClient.operation", operationId,
                () -> operationImpl(operationId));
    }

    private Map<String, Object> operationImpl(String operationId) {
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
        return telemetry.observe("DmrvnClient.readResult", operationId,
                () -> readResultImpl(operationId, reader, fromBlock, reportTxHash, waitTimedOut));
    }

    private Map<String, Object> readResultImpl(
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
                                        Json.str(s.get("claimId"), "claimId"),
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
                    var stored = Json.map(result.get("claim"), "claim");
                    if (!"0".equals(String.valueOf(stored.get("status")))) {
                        DmrvnProtocol.verifyProvenance(
                                Json.map(s.get("evidence"), "evidence"),
                                Json.str(stored.get("evidenceHash"), "evidenceHash"),
                                Json.str(stored.get("approver"), "approver"));
                        result.put("provenanceVerified", true);
                    }
                    s.put("verifiedMetadata", result.get("verifiedMetadata"));
                    result.put("deployment", Json.copy(Json.map(s.get("deployment"), "deployment")));
                    s.put("result", result);
                    if (result.containsKey("reportTxHash"))
                        s.put("reportTxHash", result.get("reportTxHash"));
                    save(key, s);
                    return result;
                });
    }
}
