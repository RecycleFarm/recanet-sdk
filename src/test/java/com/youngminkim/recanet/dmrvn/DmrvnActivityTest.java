package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.*;
import java.time.Duration;
import java.util.*;

/** New contract tests use fake RPC/storage and local test signers; no live acceptance claims. */
class DmrvnActivityTest {
    TestSupport.Rpc rpc;
    TestSupport.Storage storage;
    TestSupport.Signer operator, user;
    DeclaredMethodology methodology;
    BeneficiaryWallets wallets;
    boolean confirm = true;
    int walletRequests;
    Runnable afterConfirm = () -> {};

    @BeforeEach void setup() throws Exception {
        rpc = new TestSupport.Rpc(TestSupport.proxyConfig());
        rpc.claim.put("status", 0);
        storage = new TestSupport.Storage();
        user = new TestSupport.Signer(1);
        operator = new TestSupport.Signer(2) {
            @Override public String sendTransaction(long chain, Map<String, Object> tx, String key) {
                String hash = super.sendTransaction(chain, tx, key);
                if (confirm) {
                    var forward = Json.map(DmrvnProtocol.FORWARDER
                            .decodeCall("execute", Json.str(tx.get("data"))).get("request"));
                    String signature = Json.str(forward.remove("signature"));
                    forward.put("nonce", "11");
                    var inner = DmrvnProtocol.CLAIM.decodeCall("submitClaim", Json.str(forward.get("data")));
                    rpc.confirm(Json.obj("claimRequest", inner.get("request"),
                                    "approvalSignature", inner.get("approvalSignature")),
                            Map.of("forwardRequest", forward), signature, address());
                    afterConfirm.run();
                }
                return hash;
            }
        };
        try (var manifest = getClass().getResourceAsStream("/dmrvn/pet-manifest.json");
             var wasm = getClass().getResourceAsStream("/dmrvn/pet-methodology.wasm")) {
            // Explicit synthetic version for local tests, not a new deployed protocol version.
            methodology = new DeclaredMethodology(manifest.readAllBytes(), wasm.readAllBytes(),
                    DeclaredMethodology.PET_HASH, (a, id, v, h) -> true, 999);
        }
        wallets = (partnerId, memberId) -> {
            assertEquals(101, partnerId);
            assertEquals("member", memberId);
            walletRequests++;
            return user;
        };
    }

    DmrvnClient client() { return new DmrvnClient(rpc.config, rpc, operator, storage, methodology); }

    ActivityRequest request(Map<String, Object> inputs) {
        return new ActivityRequest("member", "partner-event", inputs, null, null, "900000",
                Duration.ZERO, Duration.ofMillis(1));
    }

    @Test void oneCallWithoutJournalCreatesEvidenceSignsAndConfirmsClaim() {
        var inputs = Json.obj("petBottleCount", "partner value", "reading", 1.25,
                "nested", Json.obj("enabled", false, "items", Arrays.asList("b", null, 3, "a")));
        var result = client().submitActivity(wallets, request(inputs));
        assertEquals("CONFIRMED", result.get("outcome"));
        assertEquals("SUBMISSION_CONFIRMED", result.get("lastConfirmedStage"));
        var known = Json.map(result.get("confirmed"));
        assertEquals("PENDING", known.get("chainStatus"));
        assertEquals("SEALED", known.get("storageStatus"));
        assertEquals(user.address(), known.get("beneficiary"));
        assertEquals(TestSupport.TX, known.get("txHash"));
        var evidence = Json.object(storage.bytes);
        assertEquals("999", String.valueOf(evidence.get("schemaVersion")));
        assertEquals(Json.canonical(inputs), Json.canonical(evidence.get("inputs")));
        assertEquals(Map.of("ownerHash", DmrvnProtocol.ownerHash(user.address())), evidence.get("source"));
        assertEquals(operator.address(), DmrvnProtocol.verifyProvenance(evidence,
                Json.str(known.get("evidenceHash")), operator.address()));
        assertEquals(operator.address(), rpc.receipt.get("from"));
        assertEquals(rpc.config.forwarderAddress(), rpc.receipt.get("to"));
        assertEquals(1, operator.messages);
        assertEquals(1, operator.typed);
        assertEquals(1, operator.sends);
        assertEquals(1, user.typed);
        assertEquals(1, walletRequests);
        assertFalse(Json.canonical(result).contains("userSignature"));
        assertFalse(Json.canonical(result).contains("approvalSignature"));
    }

    @Test void noReceiptThrowsConfirmationErrorWithoutResending() {
        confirm = false;
        var error = assertThrows(DmrvnException.class,
                () -> client().submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED, error.code());
        assertEquals(1, operator.sends);
    }

    @Test void unconfirmedClaimIsCheckedOnceEvenWithLongConfirmationTimeout() {
        confirm = false;
        var reads = new java.util.concurrent.atomic.AtomicInteger();
        String selector = DmrvnProtocol.CLAIM.topic("getClaim").substring(0, 10);
        EvmRpc tracked = (method, params) -> {
            if (operator.sends > 0 && method.equals("eth_call")
                    && Json.str(Json.map(params.get(0)).get("data")).startsWith(selector))
                assertEquals(1, reads.incrementAndGet(), "No second confirmation attempt is allowed");
            return rpc.call(method, params);
        };
        var sdk = new DmrvnClient(rpc.config, tracked, operator, storage, methodology);
        var request = new ActivityRequest("member", "partner-event", Map.of(), null, null, "900000",
                Duration.ofMinutes(10), Duration.ofMillis(1));
        var error = assertThrows(DmrvnException.class, () -> sdk.submitActivity(wallets, request));
        assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED, error.code());
        assertTrue(error.getMessage().contains("automatic polling is disabled"));
        assertEquals(1, reads.get());
        assertEquals(1, operator.sends);
    }

    @Test void inconsistentReceiptThrowsWithoutAnotherReceiptQuery() {
        afterConfirm = () -> rpc.receipt.put("transactionHash", "0x" + "ff".repeat(32));
        var reads = new java.util.concurrent.atomic.AtomicInteger();
        EvmRpc tracked = (method, params) -> {
            if (method.equals("eth_getTransactionReceipt"))
                assertEquals(1, reads.incrementAndGet(), "No receipt retry is allowed");
            return rpc.call(method, params);
        };
        var sdk = new DmrvnClient(rpc.config, tracked, operator, storage, methodology);
        var error = assertThrows(DmrvnException.class, () -> sdk.submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED, error.code());
        assertTrue(error.getMessage().contains("receipt.transactionHash"));
        assertEquals(1, reads.get());
        assertEquals(1, operator.sends);
    }

    @Test void lostSendResponsePropagatesOriginalErrorWithoutResending() {
        operator.failure = new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        assertSame(operator.failure, assertThrows(DmrvnException.class,
                () -> client().submitActivity(wallets, request(Map.of("arbitrary", -25)))));
        assertTrue(storage.sealed);
        assertEquals(1, operator.sends);
    }

    @Test void originalPrivyResponseSurvivesWalletLookupAndRelaySend(
            @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) {
        String body = "{\"code\":\"wallet_not_authorized\",\"message\":\"Original Privy explanation\"}";
        var response = new java.net.http.HttpResponse<java.io.InputStream>() {
            public int statusCode() { return 403; }
            public java.net.http.HttpRequest request() { return java.net.http.HttpRequest.newBuilder(uri()).build(); }
            public Optional<java.net.http.HttpResponse<java.io.InputStream>> previousResponse() { return Optional.empty(); }
            public java.net.http.HttpHeaders headers() { return java.net.http.HttpHeaders.of(Map.of(), (k,v) -> true); }
            public java.io.InputStream body() { return new java.io.ByteArrayInputStream(body.getBytes()); }
            public Optional<javax.net.ssl.SSLSession> sslSession() { return Optional.empty(); }
            public java.net.URI uri() { return java.net.URI.create("http://127.0.0.1"); }
            public java.net.http.HttpClient.Version version() { return java.net.http.HttpClient.Version.HTTP_1_1; }
        };
        var original = new io.privy.api.models.errors.APIException("Privy rejected wallet use", 403,
                body.getBytes(java.nio.charset.StandardCharsets.UTF_8), response, null);
        assertSame(original, assertThrows(io.privy.api.models.errors.APIException.class,
                () -> client().submitActivity((p, u) -> { throw original; }, request(Map.of()))));
        assertEquals(0, storage.creates);
        operator.failure = original;
        var error = assertThrows(io.privy.api.models.errors.APIException.class,
                () -> new DmrvnClient(rpc.config, rpc, operator, storage, methodology,
                        new FileOperationJournal(directory)).submitActivity(wallets, request(Map.of())));
        assertSame(original, error);
        assertEquals(body, error.bodyAsString().orElseThrow());
        assertEquals(403, error.code());
        assertEquals(1, operator.sends);
    }

    @Test void greenfieldRejectionPropagatesWithoutRecoveryOrIntentCleanup() {
        var original = new UpstreamException(UpstreamException.Source.GREENFIELD, 4, 0,
                "original signer rejection", "{\"codespace\":\"sdk\"}", false, true);
        var rejected = new TestSupport.Storage() {
            @Override public String create(Map<String, Object> location, byte[] bytes) { throw original; }
        };
        var journal = new MemoryOperationJournal();
        String claimId = Crypto.textHash("rejected-create");
        var request = new ActivityRequest("member", "partner-event", Map.of(), claimId, null,
                "900000", Duration.ZERO, Duration.ofMillis(1));
        assertSame(original, assertThrows(UpstreamException.class,
                () -> new DmrvnClient(rpc.config, rpc, operator, rejected, methodology, journal)
                        .submitActivity(wallets, request)));
        var state = journal.findOperationsByClaimId(claimId).get(0);
        assertTrue(state.containsKey("createIntent"));
        assertFalse(state.containsKey("lastStorageError"));
        // No Claim transaction or automatic retry follows the rejected create.
        assertEquals(0, operator.sends);
    }

    @Test void newObjectCreatesBeforeHeadAndHeadFailureStopsWithoutRecovery() {
        var calls = new ArrayList<String>();
        var original = new UpstreamException(UpstreamException.Source.GREENFIELD, "NoSuchObject", 404,
                "No such object", "original response");
        var failing = new TestSupport.Storage() {
            @Override public String create(Map<String, Object> location, byte[] bytes) {
                calls.add("create");
                return super.create(location, bytes);
            }
            @Override public GreenfieldStorage.Head head(Map<String, Object> location) {
                calls.add("head");
                throw original;
            }
        };
        assertSame(original, assertThrows(UpstreamException.class,
                () -> new DmrvnClient(rpc.config, rpc, operator, failing, methodology)
                        .submitActivity(wallets, request(Map.of()))));
        assertEquals(List.of("create", "head"), calls);
        assertEquals(0, failing.uploads);
        assertEquals(0, operator.sends);
    }

    @Test void failureAfterSealingThrowsOriginalSimulationError() {
        rpc.simulationFailure = true;
        var error = assertThrows(DmrvnException.class,
                () -> client().submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.GAS_ESTIMATION_FAILED, error.code());
        assertTrue(storage.sealed);
        assertEquals(0, operator.sends);
    }

    @Test void createResponseLossThrowsStorageErrorWithoutSendingClaim() {
        storage.loseCreate = true;
        var error = assertThrows(DmrvnException.class,
                () -> client().submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.STORAGE_UNAVAILABLE, error.code());
        assertEquals(1, storage.creates);
        assertEquals(0, operator.sends);
    }

    @Test void authorizationFailurePropagatesUnchangedBeforeEvidenceSideEffects() {
        var original = new SecurityException("member wallet use denied");
        assertSame(original, assertThrows(SecurityException.class,
                () -> client().submitActivity((p, u) -> { throw original; }, request(Map.of()))));
        assertEquals(0, operator.messages);
        assertEquals(0, storage.creates);
    }

    @Test void missingExplicitWireVersionFailsBeforeWalletProvisioning() throws Exception {
        var sdk = new DmrvnClient(rpc.config, rpc, operator, storage, TestSupport.methodology());
        var error = assertThrows(DmrvnException.class,
                () -> sdk.submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.EVIDENCE_CONTRACT_UNCONFIGURED, error.code());
        assertEquals(0, walletRequests);
        assertEquals(0, storage.creates);
    }

    @Test void optionalJournalFailureCannotHideAnAlreadyVerifiedSeal() {
        OperationJournal failing = new OperationJournal() {
            final MemoryOperationJournal delegate = new MemoryOperationJournal();
            public <T> T withLock(String k, java.util.function.Supplier<T> fn) { return delegate.withLock(k, fn); }
            public Map<String, Object> load(String k) { return delegate.load(k); }
            public List<Map<String, Object>> findOperationsByClaimId(String id) { return delegate.findOperationsByClaimId(id); }
            public void store(String k, Map<String, Object> s) {
                if (s.containsKey("upload")) throw new DmrvnException(DmrvnException.Code.JOURNAL_UNAVAILABLE);
                delegate.store(k, s);
            }
        };
        var error = assertThrows(DmrvnException.class,
                () -> new DmrvnClient(rpc.config, rpc, operator, storage, methodology, failing)
                        .submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.JOURNAL_UNAVAILABLE, error.code());
        assertTrue(storage.sealed);
        assertEquals(0, operator.sends);
    }

    @Test void differentApprovalAndRelayWalletsAreRejected() {
        assertThrows(DmrvnException.class, () -> new DmrvnClient(rpc.config, rpc,
                operator, new TestSupport.Signer(8), storage, methodology, null));
        assertEquals(0, operator.messages);
        assertEquals(0, storage.creates);
    }

    @Test void commonBeneficiaryAndMethodologyBindingsStillRejectTampering() {
        var body = methodology.evidenceBody(101, user.address(), "event", Map.of("anything", 123));
        Json.map(body.get("source")).put("kind", "PARTNER_DECLARED_INPUTS");
        assertThrows(DmrvnException.class,
                () -> client().prepareEvidence("op", Crypto.textHash("op"), user.address(),
                        "partners/101/op/evidence.json", body));
        body.put("source", Map.of("ownerHash", DmrvnProtocol.ownerHash(operator.address())));
        assertThrows(DmrvnException.class,
                () -> client().prepareEvidence("op", Crypto.textHash("op"), user.address(),
                        "partners/101/op/evidence.json", body));
        assertEquals(0, storage.creates);
    }

    @Test void receiptSenderMismatchNeverBecomesConfirmed() {
        afterConfirm = () -> rpc.receipt.put("from", user.address());
        var error = assertThrows(DmrvnException.class,
                () -> client().submitActivity(wallets, request(Map.of())));
        assertEquals(DmrvnException.Code.SUBMISSION_INPUT_CHANGED, error.code());
        assertEquals(1, operator.sends);
    }

    @Test void separateInvocationsDoNotReuseVolatileOperations() {
        var sdk = client();
        var first = sdk.submitActivity(wallets, request(Map.of()));
        var second = sdk.submitActivity(wallets, request(Map.of()));
        var a = Json.map(first.get("confirmed"));
        var b = Json.map(second.get("confirmed"));
        assertEquals("CONFIRMED", first.get("outcome"));
        assertEquals("CONFIRMED", second.get("outcome"));
        assertNotEquals(a.get("operationId"), b.get("operationId"));
        assertNotEquals(a.get("claimId"), b.get("claimId"));
        assertNotEquals(a.get("evidenceLocation"), b.get("evidenceLocation"));
        assertEquals(2, operator.sends);
    }

    @Test void methodProfileDoesNotControlPartnerInputShape() throws Exception {
        try (var in = getClass().getResourceAsStream("/dmrvn/pet-manifest.json");
             var wasm = getClass().getResourceAsStream("/dmrvn/pet-methodology.wasm")) {
            var manifest = Json.object(in.readAllBytes());
            manifest.put("activityId", 4001);
            manifest.put("methodology", Map.of("id", 5001, "version", 2));
            manifest.put("evidenceSchema", "ANOTHER_METHOD");
            manifest.put("evidenceValidation", Map.of("kind", "NODE_OWNED_VALIDATION"));
            manifest.put("inputSchema", Map.of("differentField", Map.of("type", "integer")));
            var other = new DeclaredMethodology(Json.bytes(manifest), wasm.readAllBytes(),
                    Json.hash(manifest), (a, id, v, h) -> true, 999);
            var inputs = Json.obj("partnerField", Arrays.asList(false, null, Map.of("value", "25")));
            var body = other.evidenceBody(101, user.address(), "another", inputs);
            assertEquals(Json.canonical(inputs), Json.canonical(body.get("inputs")));
            assertEquals(4001L, body.get("activityId"));
            assertEquals(Map.of("ownerHash", DmrvnProtocol.ownerHash(user.address())), body.get("source"));
        }
    }
}
