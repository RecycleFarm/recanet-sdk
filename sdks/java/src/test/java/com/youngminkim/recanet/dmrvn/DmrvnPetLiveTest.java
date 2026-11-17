package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import com.youngminkim.recanet.*;

import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.math.BigInteger;
import java.net.URI;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Explicit live test. Only the synthetic user's signature is local; backend paths are real. */
@Tag("live-dmrvn")
@EnabledIfEnvironmentVariable(named = "DMRVN_LIVE_TEST", matches = "1")
class DmrvnPetLiveTest {
    @Test
    @Timeout(value = 70, unit = TimeUnit.MINUTES)
    void userSignsThenRealRelaySubmitsAndFinalPetReportIsVerified() throws Exception {
        int evidenceVersion = Integer.parseInt(env("DMRVN_EVIDENCE_SCHEMA_VERSION"));
        int waitMinutes =
                Integer.parseInt(System.getenv().getOrDefault("DMRVN_LIVE_WAIT_MINUTES", "10"));
        if (waitMinutes < 1 || waitMinutes > 60)
            throw new IllegalArgumentException("DMRVN_LIVE_WAIT_MINUTES must be between 1 and 60");
        var user = testUser();
        var config =
                DmrvnConfig.petTestnet(101, "partners/101/", new BigInteger("1000000000000000"));
        var rpc = new HttpEvmRpc(config.rpcUrl());
        var chain = new Chain(config, rpc);
        var journal = new FileOperationJournal(Path.of(".dmrvn-journal"));
        String runId = System.getenv().getOrDefault("DMRVN_LIVE_RUN_ID", "");
        if (!runId.matches("[A-Za-z0-9_-]{0,64}"))
            throw new IllegalArgumentException("Invalid DMRVN_LIVE_RUN_ID");
        String sessionKey =
                "live-test:pet-sponsored:" + user.address() + (runId.isEmpty() ? "" : ":" + runId);
        var session =
                journal.withLock(
                        sessionKey,
                        () -> {
                            var saved = journal.load(sessionKey);
                            if (saved != null) return saved;
                            String operation = "sdk-java-pet-live-" + UUID.randomUUID();
                            var created =
                                    Json.obj(
                                            "operationId",
                                            operation,
                                            "claimId",
                                            Crypto.textHash(operation),
                                            "beneficiary",
                                            user.address());
                            journal.store(sessionKey, created);
                            return created;
                        });
        String operation = Json.str(session.get("operationId"));
        String claimId = Json.str(session.get("claimId"));
        progress("SESSION", session);
        var privy =
                new PrivyClient(
                        new PrivyClientConfig(env("PRIVY_APP_ID"), env("PRIVY_APP_SECRET")));
        var backend =
                new PrivyEvmSigner(
                        privy,
                        env("DMRVN_APPROVER_WALLET_ID"),
                        BackendWalletRegistration.fromEnvironment());
        var storage =
                new NodeGreenfieldStorage(
                        Path.of(env("DMRVN_NODE_PATH")),
                        Path.of("tools/greenfield/worker.cjs"),
                        URI.create("https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org"),
                        "5600",
                        backend.address(),
                        "GREENFIELD_STORAGE_PRIVATE_KEY",
                        env("GREENFIELD_FEE_GRANTER"),
                        Duration.ofSeconds(240));
        var publicReader =
                new GreenfieldPublicReader(
                        URI.create("https://gnfd-testnet-sp1.bnbchain.org"), "5600");
        Map<String, Object> publication;
        try (var in = getClass().getResourceAsStream("/dmrvn/pet-publication.json")) {
            publication = Json.object(in.readAllBytes());
        }
        var manifest = Json.copy(Json.map(publication.get("manifestPointer")));
        manifest.put("storageType", 1);
        manifest.put("chainId", "5600");
        var wasm = Json.copy(Json.map(publication.get("wasmPointer")));
        wasm.put("storageType", 1);
        wasm.put("chainId", "5600");
        var methodology =
                new DeclaredMethodology(
                        publicReader.read(manifest),
                        publicReader.read(wasm),
                        DeclaredMethodology.PET_HASH,
                        (a, id, v, h) -> "ACTIVE".equals(publication.get("status")), evidenceVersion);
        var sdk = new DmrvnClient(config, rpc, backend, storage, methodology, journal);
        var preflight = sdk.preflight();
        assertEquals(true, preflight.get("ready"), "Configured proxy and partner must be ready");
        var deployment = Json.map(preflight.get("verifiedMetadata"));
        assertEquals("proxy", deployment.get("deploymentKind"));
        assertEquals("7", deployment.get("protocolVersion"));
        assertEquals(config.claimAddress(), deployment.get("contractAddress"));
        progress(
                "PROXY_READY",
                Json.obj(
                        "deploymentId",
                        config.deploymentId(),
                        "implementationAddress",
                        deployment.get("implementationAddress"),
                        "contractVersion",
                        deployment.get("contractVersion"),
                        "observedBlock",
                        deployment.get("observedBlock")));
        var body =
                methodology.evidenceBody(
                        101, user.address(), operation, Map.of("petBottleCount", 3));
        progress("PREPARING_EVIDENCE", Map.of("operationId", operation));
        var prepared =
                sdk.prepareEvidence(
                        operation,
                        claimId,
                        user.address(),
                        "partners/101/activities/1003/" + operation + "/evidence.json",
                        body);
        assertEquals("SEALED", Json.map(prepared.get("upload")).get("status"));
        progress("EVIDENCE_SEALED", Json.map(prepared.get("upload")));
        if (!prepared.containsKey("submitFromBlock")) {
            sdk.approveClaim(operation);
            var request = sdk.prepareSponsored(operation, "900000");
            var forward = Json.map(request.get("forwardRequest"));
            assertEquals(config.claimAddress(), forward.get("to"));
            assertEquals("1", Json.map(request.get("domain")).get("version"));
            // This is the app boundary: the test user returns only a signature to the backend SDK.
            String signature = (String) sdk.operation(operation).get("userSignature");
            if (signature == null)
                signature =
                        user.signTypedData(
                                Json.obj(
                                        "domain",
                                        request.get("domain"),
                                        "types",
                                        request.get("types"),
                                        "primaryType",
                                        request.get("primaryType"),
                                        "message",
                                        forward));
            sdk.recordSponsoredSignature(operation, forward, signature);
            assertEquals(
                    user.address(),
                    Crypto.recover(Json.str(request.get("forwardDigest")), signature));
            progress(
                    "USER_SIGNED",
                    Map.of(
                            "beneficiary",
                            user.address(),
                            "forwardDigest",
                            request.get("forwardDigest")));
            var balance = Chain.number(chain.call("eth_getBalance", user.address(), "latest"));
            assertEquals(
                    BigInteger.ZERO,
                    balance,
                    "Fresh test user needs no ETH for sponsored submission");
            progress("RELAY_SUBMIT", sdk.submitSponsored(operation, forward, signature));
        }
        Map<String, Object> confirmed = null;
        long receiptEnd = System.nanoTime() + Duration.ofSeconds(120).toNanos();
        while (System.nanoTime() < receiptEnd) {
            try {
                confirmed = sdk.resolveSubmission(operation, null);
                break;
            } catch (DmrvnException e) {
                if (e.code() != DmrvnException.Code.SUBMISSION_UNRESOLVED) throw e;
            }
            Thread.sleep(5000);
        }
        assertNotNull(
                confirmed,
                "Receipt not confirmed; rerun reconciles the same operation without resending");
        assertEquals("CONFIRMED", confirmed.get("status"));
        progress("CLAIM_CONFIRMED", Map.of("claimId", claimId, "txHash", confirmed.get("txHash")));
        var reader =
                new DmrvnReader(
                        config,
                        rpc,
                        publicReader,
                        DmrvnReader.defaultReportResolver("5600", "dmrvn"));
        var state = sdk.operation(operation);
        long fromBlock = ((Number) state.get("submitFromBlock")).longValue();
        Map<String, Object> result = null;
        long reportEnd = System.nanoTime() + Duration.ofMinutes(waitMinutes).toNanos();
        String previous = "";
        while (System.nanoTime() < reportEnd) {
            result = reader.readResult(claimId, fromBlock, null, false, null);
            String status = Json.str(result.get("chainStatus"));
            saveResult(journal, session, result, confirmed);
            String statusDetail =
                    status + ":" + result.get("reportVerified") + ":" + result.get("reportError");
            if (!statusDetail.equals(previous)) {
                progress(
                        "RESULT",
                        Json.obj(
                                "chainStatus",
                                status,
                                "reportVerified",
                                result.get("reportVerified"),
                                "reportError",
                                result.get("reportError")));
                previous = statusDetail;
            }
            if (Boolean.TRUE.equals(result.get("reportVerified")) || "REVOKED".equals(status))
                break;
            Thread.sleep(10000);
        }
        assertNotNull(result);
        if ("PENDING".equals(result.get("chainStatus"))) {
            result = reader.readResult(claimId, fromBlock, null, true, null);
            saveResult(journal, session, result, confirmed);
            progress(
                    "LOCAL_WAIT_TIMEOUT",
                    Json.obj(
                            "claimId",
                            claimId,
                            "chainStatus",
                            result.get("chainStatus"),
                            "taskStatus",
                            result.get("taskStatus")));
        }
        assertEquals(
                "VALID",
                result.get("chainStatus"),
                "Final report not VALID; the chain state is preserved for investigation");
        assertEquals(
                true,
                result.get("reportVerified"),
                "Actual report bytes and on-chain commitments must verify");
        result =
                sdk.readResult(
                        operation, reader, fromBlock, Json.str(result.get("reportTxHash")), false);
        saveResult(journal, session, result, confirmed);
        assertEquals(true, result.get("reportVerified"));
        assertEquals(true, result.get("provenanceVerified"));
        assertEquals(prepared.get("deployment"), result.get("deployment"));
        var output = Json.map(Json.map(result.get("outputs")).get("estimated_co2e"));
        assertEquals("60", output.get("value"));
        assertEquals("gCO2e", output.get("unit"));
        assertEquals("0", String.valueOf(output.get("scale")));
        assertEquals(
                BigInteger.ZERO,
                Chain.number(chain.call("eth_getBalance", user.address(), "latest")));
        assertEquals(
                0,
                user.sends,
                "Test user supplies only a signature; the real Privy Relay sends the transaction");
        progress(
                "PASS",
                Json.obj(
                        "claimId",
                        claimId,
                        "beneficiary",
                        user.address(),
                        "submissionTxHash",
                        confirmed.get("txHash"),
                        "reportTxHash",
                        result.get("reportTxHash"),
                        "reportHash",
                        result.get("reportHash"),
                        "outputs",
                        result.get("outputs")));
    }

    private static void saveResult(
            FileOperationJournal journal,
            Map<String, Object> session,
            Map<String, Object> result,
            Map<String, Object> confirmed) {
        var snapshot = Json.obj("session", session, "submission", confirmed, "result", result);
        String resultKey = "live-test:pet-result:" + Json.str(session.get("operationId"));
        journal.withLock(
                resultKey,
                () -> {
                    journal.store(resultKey, snapshot);
                    return null;
                });
        journal.withLock(
                "live-test:pet-latest-result",
                () -> {
                    journal.store("live-test:pet-latest-result", snapshot);
                    return null;
                });
    }

    private static TestSupport.Signer testUser() throws Exception {
        Path directory = Path.of(".dmrvn-test-secrets");
        Files.createDirectories(directory);
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
        Path file = directory.resolve("pet-beneficiary.key");
        if (!Files.exists(file)) {
            BigInteger scalar, order = CustomNamedCurves.getByName("secp256k1").getN();
            var random = new SecureRandom();
            do {
                scalar = new BigInteger(256, random);
            } while (scalar.signum() == 0 || scalar.compareTo(order) >= 0);
            Files.createFile(
                    file,
                    PosixFilePermissions.asFileAttribute(
                            PosixFilePermissions.fromString("rw-------")));
            Files.write(
                    file, Crypto.word(scalar), StandardOpenOption.WRITE, StandardOpenOption.SYNC);
        }
        byte[] bytes = Files.readAllBytes(file);
        if (bytes.length != 32) throw new IllegalStateException("Invalid test-only key file");
        return new TestSupport.Signer(new BigInteger(1, bytes));
    }

    private static String env(String name) {
        return Objects.requireNonNull(System.getenv(name), name);
    }

    private static void progress(String stage, Map<String, Object> data) {
        System.out.println(stage + " " + Json.canonical(data));
        System.out.flush();
    }
}
