package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;

class DmrvnClientTest {
    @TempDir Path dir;
    TestSupport.Rpc rpc;
    TestSupport.Signer user, approver, relay;
    TestSupport.Storage storage;
    DeclaredMethodology methodology;
    FileOperationJournal journal;
    DmrvnClient client;

    @BeforeEach
    void setup() throws Exception {
        rpc = new TestSupport.Rpc(TestSupport.proxyConfig());
        user = new TestSupport.Signer(1);
        approver = new TestSupport.Signer(2);
        relay = approver;
        storage = new TestSupport.Storage();
        methodology = TestSupport.methodology();
        journal = new FileOperationJournal(dir);
        client = make(journal);
    }

    DmrvnClient make(OperationJournal j) {
        return new DmrvnClient(rpc.config, rpc, approver, storage, methodology, j);
    }

    Map<String, Object> body(String event) {
        return methodology.evidenceBody(101, user.address(), event, Map.of("petBottleCount", 3));
    }

    String id(String value) {
        return Crypto.textHash(value);
    }

    Map<String, Object> prepare(String op) {
        return client.prepare(
                op, id(op), user.address(), "partners/101/" + op + "/evidence.json", body(op));
    }

    Map<String, Object> submitActivity(String op) {
        return client.submitActivity(
                user, op, id(op), "partners/101/" + op + "/evidence.json", body(op), "900000");
    }

    @Test
    void activityUploadsSignsAndSubmitsThenRecoversAfterExpiryWithoutResigning() {
        assertEquals("BROADCAST", submitActivity("activity").get("status"));
        var state = client.operation("activity");
        assertEquals(user.address(), state.get("beneficiary"));
        assertEquals("SEALED", Json.map(state.get("upload")).get("status"));
        rpc.confirm(Json.map(state.get("approved")), Json.map(state.get("sponsored")),
                Json.str(state.get("userSignature")), relay.address());
        rpc.timestamp += 1000;
        client = make(new FileOperationJournal(dir));
        assertEquals("CONFIRMED", submitActivity("activity").get("status"));
        assertEquals(state.get("userSignature"), client.operation("activity").get("userSignature"));
        assertEquals(1, storage.uploads);
        assertEquals(1, approver.messages);
        assertEquals(1, approver.typed);
        assertEquals(1, user.typed);
        assertEquals(1, relay.sends);
    }

    @Test
    void activityDoesNotResendWhenRelayResponseIsLost() {
        relay.failure = new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED,
                assertThrows(DmrvnException.class, () -> submitActivity("lost-activity")).code());
        relay.failure = null;
        client = make(new FileOperationJournal(dir));
        assertEquals(DmrvnException.Code.SUBMISSION_UNRESOLVED,
                assertThrows(DmrvnException.class, () -> submitActivity("lost-activity")).code());
        var state = client.operation("lost-activity");
        rpc.confirm(Json.map(state.get("approved")), Json.map(state.get("sponsored")),
                Json.str(state.get("userSignature")), relay.address());
        assertEquals("CONFIRMED", submitActivity("lost-activity").get("status"));
        assertEquals(1, user.typed);
        assertEquals(1, relay.sends);
        assertEquals(1, storage.uploads);
    }

    @Test
    void activityReusesPersistedSignatureAfterFailureBeforeBroadcast() {
        var approved = prepare("signed-activity");
        var signing = client.prepareSponsored("signed-activity", "900000");
        var forward = Json.map(signing.get("forwardRequest"));
        String signature = user.signTypedData(DmrvnProtocol.typedData(
                "ForwardRequest", Json.map(signing.get("domain")), forward));
        client.recordSponsoredSignature("signed-activity", forward, signature);
        client = make(new FileOperationJournal(dir));
        assertEquals("BROADCAST", submitActivity("signed-activity").get("status"));
        assertEquals(approved, client.operation("signed-activity").get("approved"));
        assertEquals(signature, client.operation("signed-activity").get("userSignature"));
        assertEquals(1, user.typed);
    }

    @Test
    void activityRejectsChangedInputsAndWrongBeneficiaryBeforeSigning() {
        submitActivity("immutable-activity");
        var changed = methodology.evidenceBody(101, user.address(), "immutable-activity",
                Map.of("petBottleCount", 4));
        assertEquals(DmrvnException.Code.OPERATION_INPUT_CHANGED,
                assertThrows(DmrvnException.class, () -> client.submitActivity(
                        user, "immutable-activity", id("immutable-activity"),
                        "partners/101/immutable-activity/evidence.json", changed, "900000")).code());
        assertEquals(DmrvnException.Code.SUBMISSION_INPUT_CHANGED,
                assertThrows(DmrvnException.class, () -> client.submitActivity(
                        user, "immutable-activity", id("immutable-activity"),
                        "partners/101/immutable-activity/evidence.json", body("immutable-activity"),
                        "800000")).code());
        assertThrows(DmrvnException.class, () -> client.submitActivity(
                new TestSupport.Signer(9), "wrong-user", id("wrong-user"),
                "partners/101/wrong-user/evidence.json", body("wrong-user"), "900000"));
        assertEquals(1, storage.uploads);
        assertEquals(1, user.typed);
        assertEquals(1, relay.sends);
    }

    @Test
    void concurrentActivityCallsUploadSignAndSendOnce() throws Exception {
        var executor = Executors.newFixedThreadPool(2);
        try {
            var gate = new CountDownLatch(1);
            Callable<String> task = () -> {
                gate.await();
                try {
                    return Json.str(submitActivity("concurrent-activity").get("status"));
                } catch (DmrvnException e) {
                    return e.code().name();
                }
            };
            var first = executor.submit(task);
            var second = executor.submit(task);
            gate.countDown();
            assertEquals(Set.of("BROADCAST", "SUBMISSION_UNRESOLVED"),
                    Set.of(first.get(30, TimeUnit.SECONDS), second.get(30, TimeUnit.SECONDS)));
        } finally {
            executor.shutdownNow();
        }
        assertEquals(1, storage.uploads);
        assertEquals(1, approver.typed);
        assertEquals(1, user.typed);
        assertEquals(1, relay.sends);
    }

    @Test
    void activityRejectsSignatureFromAnotherWalletWithoutSending() {
        var wrongSigner = new TestSupport.Signer(1) {
            @Override
            public String signTypedData(Map<String, Object> data) {
                return new TestSupport.Signer(9).signTypedData(data);
            }
        };
        assertEquals(DmrvnException.Code.SIGNATURE_INVALID,
                assertThrows(DmrvnException.class, () -> client.submitActivity(
                        wrongSigner, "bad-signature", id("bad-signature"),
                        "partners/101/bad-signature/evidence.json", body("bad-signature"),
                        "900000")).code());
        assertEquals(0, relay.sends);
        assertFalse(client.operation("bad-signature").containsKey("userSignature"));
        assertEquals("BROADCAST", submitActivity("bad-signature").get("status"));
        assertEquals(1, storage.uploads);
    }

    @Test
    void approvedUpgradeReusesExactCheckpointAndPreservesFirstDeployment() {
        var approved = prepare("upgrade");
        var sponsored = client.prepareSponsored("upgrade", "900000");
        var forward = Json.map(sponsored.get("forwardRequest"));
        String signature =
                user.signTypedData(
                        DmrvnProtocol.typedData(
                                "ForwardRequest", Json.map(sponsored.get("domain")), forward));
        client.recordSponsoredSignature("upgrade", forward, signature);
        var before = client.operation("upgrade");
        assertEquals(rpc.config.claimAddress(), forward.get("to"));
        assertEquals(
                rpc.config.claimAddress(),
                DmrvnProtocol.domain(rpc.config.chainId(), rpc.config.claimAddress(), false)
                        .get("verifyingContract"));
        rpc.implementation = "0x6666666666666666666666666666666666666666";
        rpc.version = "1.0.1";
        client = make(new FileOperationJournal(dir));
        assertEquals(approved, prepare("upgrade"));
        assertEquals(sponsored, client.prepareSponsored("upgrade", "900000"));
        assertEquals(
                "BROADCAST", client.submitSponsored("upgrade", forward, signature).get("status"));
        var after = client.operation("upgrade");
        for (String field :
                List.of(
                        "deployment",
                        "evidence",
                        "approved",
                        "sponsored",
                        "forwardRequest",
                        "userSignature",
                        "forwardDigest")) assertEquals(before.get(field), after.get(field), field);
        assertEquals("1.0.0", Json.map(after.get("deployment")).get("contractVersion"));
        assertEquals("1.0.1", Json.map(after.get("verifiedMetadata")).get("contractVersion"));
        assertEquals(1, storage.uploads);
        assertEquals(1, approver.messages);
        assertEquals(1, approver.typed);
        assertEquals(1, user.typed);
        assertEquals(1, relay.sends);
    }

    @Test
    void pendingUpgradeAndRoleRevocationPreserveRecoveryAndStoredProvenance() {
        var approved = prepare("pending");
        var transaction = client.prepareSelfPaid("pending");
        assertEquals(rpc.config.claimAddress(), transaction.get("to"));
        rpc.confirm(approved, null, null, null);
        var before = client.operation("pending");
        rpc.implementation = "0x6666666666666666666666666666666666666666";
        rpc.version = "1.0.1";
        rpc.role = false;
        assertEquals(
                "CONFIRMED", client.resolveSubmission("pending", TestSupport.TX).get("status"));
        var reader =
                new DmrvnReader(
                        rpc.config,
                        rpc,
                        p -> {
                            throw new AssertionError();
                        },
                        DmrvnReader.defaultReportResolver("5600", "offline-fixture"));
        var result = client.readResult("pending", reader, null, null, true);
        assertEquals("PENDING", result.get("chainStatus"));
        assertEquals("LOCAL_WAIT_TIMEOUT", result.get("observationStatus"));
        assertEquals(false, result.get("reportVerified"));
        assertEquals(true, result.get("provenanceVerified"));
        assertEquals(before.get("deployment"), result.get("deployment"));
        assertEquals("1.0.1", Json.map(result.get("verifiedMetadata")).get("contractVersion"));
        assertEquals(
                approver.address(),
                reader.verifyEvidenceProvenance(id("pending"), Json.bytes(before.get("evidence"))));
        rpc.claim.put("approver", new TestSupport.Signer(8).address());
        assertThrows(
                DmrvnException.class,
                () ->
                        reader.verifyEvidenceProvenance(
                                id("pending"), Json.bytes(before.get("evidence"))));
        assertThrows(
                DmrvnException.class, () -> client.resolveSubmission("pending", TestSupport.TX));
    }

    @Test
    void unapprovedUpgradeClearsCurrentVerificationAndBlocksAllPreparation() {
        prepare("unapproved");
        var sponsored = client.prepareSponsored("unapproved", "900000");
        var before = client.operation("unapproved");
        rpc.implementation = "0x7777777777777777777777777777777777777777";
        var preflight = client.preflight();
        assertEquals(false, preflight.get("ready"));
        assertNull(preflight.get("verifiedMetadata"));
        for (Runnable action :
                List.<Runnable>of(
                        () -> prepare("unapproved"),
                        () -> client.approveClaim("unapproved"),
                        () -> client.prepareSponsored("unapproved", "900000"),
                        () ->
                                client.submitSponsored(
                                        "unapproved",
                                        Json.map(sponsored.get("forwardRequest")),
                                        user.sign(Json.str(sponsored.get("forwardDigest"))))))
            assertEquals(
                    DmrvnException.Code.UNAPPROVED_IMPLEMENTATION,
                    assertThrows(DmrvnException.class, action::run).code());
        var after = client.operation("unapproved");
        assertEquals(false, after.get("ready"));
        assertFalse(after.containsKey("verifiedMetadata"));
        for (String field : List.of("deployment", "evidence", "approved", "sponsored"))
            assertEquals(before.get(field), after.get(field));
        assertEquals(1, storage.uploads);
        assertEquals(1, approver.typed);
        assertEquals(0, relay.sends);
        rpc.implementation = "0x3333333333333333333333333333333333333333";
        assertEquals(before.get("approved"), client.approveClaim("unapproved"));
    }

    @Test
    void upgradeDoesNotBypassExpiredNonceOrApproverConditions() {
        prepare("conditions");
        var sponsored = client.prepareSponsored("conditions", "900000");
        var forward = Json.map(sponsored.get("forwardRequest"));
        String signature = user.sign(Json.str(sponsored.get("forwardDigest")));
        client.recordSponsoredSignature("conditions", forward, signature);
        rpc.implementation = "0x6666666666666666666666666666666666666666";
        rpc.version = "1.0.1";
        rpc.timestamp = 2000000100;
        assertEquals(
                DmrvnException.Code.REQUEST_EXPIRED,
                assertThrows(
                                DmrvnException.class,
                                () -> client.submitSponsored("conditions", forward, signature))
                        .code());
        rpc.timestamp = 1999999100;
        rpc.claimNonce = java.math.BigInteger.valueOf(8);
        assertEquals(
                DmrvnException.Code.NONCE_CONFLICT,
                assertThrows(
                                DmrvnException.class,
                                () -> client.submitSponsored("conditions", forward, signature))
                        .code());
        rpc.claimNonce = java.math.BigInteger.valueOf(7);
        rpc.role = false;
        assertEquals(
                DmrvnException.Code.UNAUTHORIZED_SIGNER,
                assertThrows(
                                DmrvnException.class,
                                () -> client.submitSponsored("conditions", forward, signature))
                        .code());
        assertEquals(1, approver.typed);
        assertEquals(signature, client.operation("conditions").get("userSignature"));
        assertEquals(0, relay.sends);
    }

    @Test
    void crossDeploymentCollisionIncludesLegacyUnindexedOperationsAndReservations() {
        String legacy = "421614:0x10615cb528fe09c73819f8f3345efb8024a81d15";
        var old =
                Json.obj(
                        "operationId",
                        "legacy",
                        "claimId",
                        id("collision"),
                        "deploymentId",
                        legacy);
        journal.withLock(
                "operation:legacy",
                () -> {
                    journal.store("operation:legacy", old);
                    return null;
                });
        assertEquals(
                DmrvnException.Code.DEPLOYMENT_COLLISION,
                assertThrows(DmrvnException.class, () -> prepare("collision")).code());
        assertEquals(old, journal.load("operation:legacy"));
        assertNull(journal.load("operation:collision"));
        String reservation = "claim-id:" + id("reserved");
        journal.withLock(
                reservation,
                () -> {
                    journal.store(
                            reservation, Json.obj("operationId", "other", "deploymentId", legacy));
                    return null;
                });
        assertEquals(
                DmrvnException.Code.DEPLOYMENT_COLLISION,
                assertThrows(DmrvnException.class, () -> prepare("reserved")).code());
        assertEquals(0, approver.messages);
        assertEquals(0, storage.creates);
    }

    @Test
    void historicalDirectCannotCreateNewApprovals() throws Exception {
        var direct = new TestSupport.Rpc();
        client =
                new DmrvnClient(
                        direct.config, direct, approver, storage, methodology, journal);
        assertEquals(false, client.preflight().get("ready"));
        assertEquals(
                DmrvnException.Code.DEPLOYMENT_NOT_READY,
                assertThrows(DmrvnException.class, () -> prepare("direct")).code());
        assertEquals(0, storage.creates);
        assertEquals(0, approver.messages);
    }

    @Test
    void prepareIsDurableAndRejectsChangedInputBeforeSideEffects() {
        var first = prepare("one");
        client = make(new FileOperationJournal(dir));
        assertEquals(first, prepare("one"));
        assertEquals(1, storage.creates);
        assertEquals(1, approver.messages);
        assertEquals(1, approver.typed);
        assertEquals(
                DmrvnException.Code.OPERATION_INPUT_CHANGED,
                assertThrows(
                                DmrvnException.class,
                                () ->
                                        client.prepareEvidence(
                                                "one",
                                                id("one"),
                                                user.address(),
                                                "partners/101/other.json",
                                                body("one")))
                        .code());
        assertEquals(1, storage.creates);
        var detached = client.operation("one");
        detached.clear();
        assertFalse(client.operation("one").isEmpty());
    }

    @Test
    void createResponseLossRequiresOriginalTransactionAndDoesNotCreateAgain() {
        storage.loseCreate = true;
        assertThrows(DmrvnException.class, () -> prepare("lost"));
        storage.loseCreate = false;
        assertEquals(
                DmrvnException.Code.STORAGE_CREATE_UNRESOLVED,
                assertThrows(DmrvnException.class, () -> prepare("lost")).code());
        client = make(new FileOperationJournal(dir));
        client.recoverCreateTransaction("lost", "ab".repeat(32));
        prepare("lost");
        assertEquals(1, storage.creates);
        assertEquals(1, storage.uploads);
    }

    @Test
    void nonceReservationBlocksAnotherOperationUntilReceiptConfirmed() {
        var a = prepare("one");
        assertEquals(
                DmrvnException.Code.NONCE_CONFLICT,
                assertThrows(DmrvnException.class, () -> prepare("two")).code());
        client.prepareSelfPaid("one");
        rpc.confirm(a, null, null, null);
        assertEquals("CONFIRMED", client.resolveSubmission("one", TestSupport.TX).get("status"));
        assertEquals("8", Json.map(prepare("two").get("claimRequest")).get("nonce"));
    }

    @Test
    void sponsoredValidatesUserSignsOnceAndResolvesInsteadOfResending() {
        var a = prepare("one");
        var sponsored = client.prepareSponsored("one", "900000");
        var f = Json.map(sponsored.get("forwardRequest"));
        String signature = user.sign(Json.str(sponsored.get("forwardDigest")));
        assertEquals("BROADCAST", client.submitSponsored("one", f, signature).get("status"));
        assertEquals(1, relay.sends);
        assertEquals(
                DmrvnException.Code.SUBMISSION_UNRESOLVED,
                assertThrows(
                                DmrvnException.class,
                                () -> client.submitSponsored("one", f, signature))
                        .code());
        assertEquals(1, relay.sends);
        rpc.confirm(a, sponsored, signature, relay.address());
        client = make(new FileOperationJournal(dir));
        assertEquals("CONFIRMED", client.submitSponsored("one", f, signature).get("status"));
        assertEquals(1, relay.sends);
        assertEquals(
                "SUBMITTED",
                client.prepareEvidence(
                                "one",
                                id("one"),
                                user.address(),
                                "partners/101/one/evidence.json",
                                body("one"))
                        .get("phase"));
    }

    @Test
    void rejectsTamperingBeforeBroadcastAndPreservesOriginalRequest() {
        prepare("one");
        var s = client.prepareSponsored("one", "900000");
        var f = Json.copy(Json.map(s.get("forwardRequest")));
        f.put("gas", "900001");
        assertEquals(
                DmrvnException.Code.SUBMISSION_INPUT_CHANGED,
                assertThrows(
                                DmrvnException.class,
                                () ->
                                        client.submitSponsored(
                                                "one",
                                                f,
                                                user.sign(Json.str(s.get("forwardDigest")))))
                        .code());
        assertEquals(0, relay.sends);
        assertFalse(client.operation("one").containsKey("submitFromBlock"));
        assertThrows(
                DmrvnException.class,
                () ->
                        client.submitSponsored(
                                "one",
                                Json.map(s.get("forwardRequest")),
                                approver.sign(Json.str(s.get("forwardDigest")))));
    }

    @Test
    void lostBroadcastAndJournalResponseAreReconciledWithoutAnotherSend() {
        var a = prepare("one");
        var s = client.prepareSponsored("one", "900000");
        var f = Json.map(s.get("forwardRequest"));
        String sig = user.sign(Json.str(s.get("forwardDigest")));
        relay.failure = new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        assertThrows(DmrvnException.class, () -> client.submitSponsored("one", f, sig));
        rpc.confirm(a, s, sig, relay.address());
        relay.failure = null;
        assertEquals("CONFIRMED", client.submitSponsored("one", f, sig).get("status"));
        assertEquals(1, relay.sends);
    }

    @Test
    void directReceiptRequiresBeneficiaryAndCorrectTransaction() {
        var a = prepare("one");
        var tx = client.prepareSelfPaid("one");
        assertEquals(DmrvnProtocol.submitCalldata(a), tx.get("data"));
        assertEquals(0, relay.sends);
        rpc.confirm(a, null, null, null);
        rpc.receipt.put("from", relay.address());
        assertThrows(DmrvnException.class, () -> client.resolveSubmission("one", TestSupport.TX));
        rpc.receipt.put("from", user.address());
        assertEquals("CONFIRMED", client.resolveSubmission("one", TestSupport.TX).get("status"));
    }

    @Test
    void concurrentPrepareSignsCreatesAndApprovesOnce() throws Exception {
        var executor = Executors.newFixedThreadPool(4);
        try {
            var futures =
                    executor.invokeAll(
                            List.of(
                                    () -> prepare("one"),
                                    () -> prepare("one"),
                                    () -> prepare("one"),
                                    () -> prepare("one")));
            for (var f : futures) assertNotNull(f.get());
        } finally {
            executor.shutdownNow();
        }
        assertEquals(1, approver.messages);
        assertEquals(1, storage.creates);
        assertEquals(1, approver.typed);
    }

    @Test
    void partnerOwnsInputFieldsTypesAndRanges() {
        for (Object value : List.of(0, -1, 100001, 1.5, "3", false, List.of(3, 1))) {
            var inputs = Map.of("petBottleCount", value, "extra", (Object) Map.of("unit", "arbitrary"));
            var evidence = methodology.evidenceBody(101, user.address(), "one", inputs);
            assertEquals(Json.canonical(inputs), Json.canonical(evidence.get("inputs")));
            assertEquals(Map.of("ownerHash", DmrvnProtocol.ownerHash(user.address())), evidence.get("source"));
        }
        assertEquals(Map.of(), methodology.evidenceBody(101, user.address(), "empty", Map.of()).get("inputs"));
        assertEquals(0, approver.messages);
        assertEquals(0, storage.creates);
    }

    @Test
    void noApprovalBeforeSealAndStoredBytesMatch() {
        storage.sealed = true;
        storage.exists = true;
        storage.bytes = "{}".getBytes();
        assertEquals(
                DmrvnException.Code.STORAGE_MISMATCH,
                assertThrows(DmrvnException.class, () -> prepare("one")).code());
        assertEquals(0, approver.typed);
    }

    @Test
    void definitivePreBroadcastStorageRejectionReusesEvidenceOnRetry() {
        var rejected =
                new TestSupport.Storage() {
                    boolean first = true;

                    @Override
                    public String create(Map<String, Object> location, byte[] data) {
                        if (first) {
                            first = false;
                            throw new DmrvnException(
                                    DmrvnException.Code.STORAGE_ACCOUNT_UNFUNDED, true);
                        }
                        return super.create(location, data);
                    }
                };
        client = new DmrvnClient(rpc.config, rpc, approver, rejected, methodology, journal);
        assertEquals(
                DmrvnException.Code.STORAGE_ACCOUNT_UNFUNDED,
                assertThrows(DmrvnException.class, () -> prepare("one")).code());
        assertFalse(client.operation("one").containsKey("createIntent"));
        prepare("one");
        assertEquals(1, approver.messages);
        assertEquals(1, rejected.creates);
    }

    @Test
    void checkTxRejectionReusesEvidenceButClearsStaleErrorAfterSuccess() {
        var rejected =
                new TestSupport.Storage() {
                    boolean first = true;

                    @Override
                    public String create(Map<String, Object> location, byte[] data) {
                        if (first) {
                            first = false;
                            throw new DmrvnException(
                                    DmrvnException.Code.SIGNATURE_INVALID, false, true);
                        }
                        return super.create(location, data);
                    }
                };
        client = new DmrvnClient(rpc.config, rpc, approver, rejected, methodology, journal);
        var error = assertThrows(DmrvnException.class, () -> prepare("one"));
        assertTrue(error.definitelyRejected());
        assertFalse(error.definitelyNotBroadcast());
        assertFalse(client.operation("one").containsKey("createIntent"));
        var original = Json.canonical(client.operation("one").get("evidence"));
        prepare("one");
        assertEquals(original, Json.canonical(client.operation("one").get("evidence")));
        assertFalse(client.operation("one").containsKey("lastStorageError"));
        assertEquals(1, approver.messages);
        assertEquals(1, rejected.creates);
    }
}
