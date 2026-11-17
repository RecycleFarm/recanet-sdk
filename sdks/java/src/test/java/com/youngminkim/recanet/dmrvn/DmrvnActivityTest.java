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

    @Test void noReceiptReturnsUnknownWithoutRetryingOrCallingItFinalFailure() {
        confirm = false;
        var result = client().submitActivity(wallets, request(Map.of()));
        assertEquals("UNKNOWN", result.get("outcome"));
        assertEquals("SUBMISSION_BROADCAST", result.get("lastConfirmedStage"));
        var known = Json.map(result.get("confirmed"));
        assertEquals(TestSupport.TX, known.get("txHash"));
        assertEquals("SEALED", known.get("storageStatus"));
        assertFalse(known.containsKey("chainStatus"));
        assertEquals(1, operator.sends);
    }

    @Test void lostSendResponseKeepsSealedFactsAndDoesNotInventTransactionHash() {
        operator.failure = new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        var result = client().submitActivity(wallets, request(Map.of("arbitrary", -25)));
        assertEquals("UNKNOWN", result.get("outcome"));
        assertEquals("BENEFICIARY_SIGNED", result.get("lastConfirmedStage"));
        var known = Json.map(result.get("confirmed"));
        assertEquals("SEALED", known.get("storageStatus"));
        assertTrue(known.containsKey("evidenceLocation"));
        assertFalse(known.containsKey("txHash"));
        assertEquals(1, operator.sends);
    }

    @Test void failureAfterSealingReturnsStoredIdentifiersWithoutClaimSuccess() {
        rpc.simulationFailure = true;
        var result = client().submitActivity(wallets, request(Map.of()));
        assertEquals("FAILED", result.get("outcome"));
        assertEquals("GAS_ESTIMATION_FAILED", result.get("errorCode"));
        var known = Json.map(result.get("confirmed"));
        assertEquals("SEALED", known.get("storageStatus"));
        assertTrue(known.containsKey("evidenceLocation"));
        assertTrue(known.containsKey("createTxHash"));
        assertFalse(known.containsKey("txHash"));
        assertEquals(0, operator.sends);
    }

    @Test void createResponseLossExposesRequestedPathWithoutClaimingStorageSuccess() {
        storage.loseCreate = true;
        var result = client().submitActivity(wallets, request(Map.of()));
        assertEquals("UNKNOWN", result.get("outcome"));
        assertEquals("EVIDENCE_SIGNED", result.get("lastConfirmedStage"));
        var known = Json.map(result.get("confirmed"));
        assertFalse(known.containsKey("createTxHash"));
        assertFalse(known.containsKey("storageStatus"));
        assertFalse(known.containsKey("evidenceLocation"));
        assertNotNull(Json.map(result.get("requested")).get("evidenceLocation"));
        assertEquals(0, operator.sends);
    }

    @Test void authorizationFailureIsSanitizedAndStopsBeforeEvidenceSideEffects() {
        var result = client().submitActivity((p, u) -> {
            throw new SecurityException("sensitive partner credential");
        }, request(Map.of()));
        assertEquals("FAILED", result.get("outcome"));
        assertEquals("UNAUTHORIZED_SIGNER", result.get("errorCode"));
        assertEquals("REQUEST_ACCEPTED", result.get("lastConfirmedStage"));
        assertEquals(0, operator.messages);
        assertEquals(0, storage.creates);
        assertFalse(Json.canonical(result).contains("sensitive"));
    }

    @Test void missingExplicitWireVersionFailsBeforeWalletProvisioning() throws Exception {
        var sdk = new DmrvnClient(rpc.config, rpc, operator, storage, TestSupport.methodology());
        var result = sdk.submitActivity(wallets, request(Map.of()));
        assertEquals("EVIDENCE_CONTRACT_UNCONFIGURED", result.get("errorCode"));
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
        var result = new DmrvnClient(rpc.config, rpc, operator, storage, methodology, failing)
                .submitActivity(wallets, request(Map.of()));
        assertEquals("FAILED", result.get("outcome"));
        assertEquals("EVIDENCE_SEALED", result.get("lastConfirmedStage"));
        assertEquals("SEALED", Json.map(result.get("confirmed")).get("storageStatus"));
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
        var result = client().submitActivity(wallets, request(Map.of()));
        assertEquals("UNKNOWN", result.get("outcome"));
        assertEquals("SUBMISSION_INPUT_CHANGED", result.get("errorCode"));
        assertFalse(Json.map(result.get("confirmed")).containsKey("chainStatus"));
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
