package com.youngminkim.recanet.dmrvn;

import com.youngminkim.recanet.*;

import java.net.URI;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.*;

/**
 * Explicit testnet workflow. App signatures/transactions are supplied by the user, never created
 * here.
 */
public final class DmrvnPetExample {
    public static void main(String[] args) throws Exception {
        String action = args[0];
        if (!Set.of("evidence", "sponsored", "self-paid", "submit", "resolve", "read")
                .contains(action)) throw new IllegalArgumentException("Unknown action");
        Path directory = Path.of(".dmrvn-journal");
        var journal = new FileOperationJournal(directory);
        String beneficiary =
                Objects.requireNonNull(System.getenv("DMRVN_BENEFICIARY"), "DMRVN_BENEFICIARY");
        String mode = System.getenv().getOrDefault("DMRVN_SUBMISSION_MODE", "sponsored");
        if (!Set.of("sponsored", "self-paid").contains(mode))
            throw new IllegalArgumentException("Invalid mode");
        String sessionKey = "pet-example:" + mode + ":" + Crypto.address(beneficiary);
        String runId = System.getenv().getOrDefault("DMRVN_PET_RUN_ID", "");
        if (!runId.matches("[A-Za-z0-9_-]{0,64}"))
            throw new IllegalArgumentException("Invalid DMRVN_PET_RUN_ID");
        final String selectedSession = sessionKey + (runId.isEmpty() ? "" : ":" + runId);
        var session =
                journal.withLock(
                        selectedSession,
                        () -> {
                            var saved = journal.load(selectedSession);
                            if (saved != null) return saved;
                            String id = "sdk-java-pet-" + mode + "-" + UUID.randomUUID();
                            var created =
                                    Json.obj(
                                            "operationId",
                                            id,
                                            "claimId",
                                            Crypto.textHash(id),
                                            "sourceEventId",
                                            id);
                            journal.store(selectedSession, created);
                            return created;
                        });
        String operation = Json.str(session.get("operationId"));
        var config = DmrvnDiagnostics.configuration();
        var existingOperation = journal.load("operation:" + operation);
        if (existingOperation != null
                && !config.deploymentId().equals(existingOperation.get("deploymentId")))
            throw new DmrvnException(DmrvnException.Code.DEPLOYMENT_COLLISION);
        var rpc = new HttpEvmRpc(config.rpcUrl());
        var publicReader =
                new GreenfieldPublicReader(
                        URI.create("https://gnfd-testnet-sp1.bnbchain.org"), "5600");
        var reader =
                new DmrvnReader(
                        config,
                        rpc,
                        publicReader,
                        DmrvnReader.defaultReportResolver("5600", "dmrvn"));
        if (action.equals("read")) {
            var state = journal.load("operation:" + operation);
            var result =
                    reader.readResult(
                            Json.str(session.get("claimId")),
                            state != null && state.get("submitFromBlock") instanceof Number n
                                    ? n.longValue()
                                    : null,
                            System.getenv("DMRVN_REPORT_TX_HASH"),
                            false,
                            null);
            write(directory.resolve(mode + "-result.json"), result);
            System.out.println(
                    Json.canonical(
                            Json.obj(
                                    "claimId",
                                    session.get("claimId"),
                                    "chainStatus",
                                    result.get("chainStatus"),
                                    "reportVerified",
                                    result.get("reportVerified"),
                                    "reportError",
                                    result.get("reportError"),
                                    "outputs",
                                    result.get("outputs"))));
            return;
        }
        var privy =
                new PrivyClient(
                        new PrivyClientConfig(
                                System.getenv("PRIVY_APP_ID"), System.getenv("PRIVY_APP_SECRET")));
        var signer =
                new PrivyEvmSigner(
                        privy,
                        Objects.requireNonNull(System.getenv("DMRVN_APPROVER_WALLET_ID")),
                        BackendWalletRegistration.fromEnvironment());
        var storage =
                new NodeGreenfieldStorage(
                        Path.of(Objects.requireNonNull(System.getenv("DMRVN_NODE_PATH"))),
                        Path.of("tools/greenfield/worker.cjs"),
                        URI.create("https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org"),
                        "5600",
                        signer.address(),
                        "GREENFIELD_STORAGE_PRIVATE_KEY",
                        System.getenv().getOrDefault("GREENFIELD_FEE_GRANTER", ""),
                        Duration.ofSeconds(240));
        Map<String, Object> publication;
        try (var in = DmrvnPetExample.class.getResourceAsStream("/dmrvn/pet-publication.json")) {
            publication = Json.object(in.readAllBytes());
        }
        var manifest = Json.copy(Json.map(publication.get("manifestPointer")));
        manifest.put("storageType", 1);
        manifest.put("chainId", "5600");
        var wasm = Json.copy(Json.map(publication.get("wasmPointer")));
        wasm.put("storageType", 1);
        wasm.put("chainId", "5600");
        // This example uses the supplied RCF ACTIVE snapshot, explicitly identified in the saved
        // evidence.
        // Production must inject a current operator/Registry adapter into DeclaredMethodology.
        var methodology =
                new DeclaredMethodology(
                        publicReader.read(manifest),
                        publicReader.read(wasm),
                        DeclaredMethodology.PET_HASH,
                        (a, id, v, h) -> "ACTIVE".equals(publication.get("status")));
        var sdk = new DmrvnClient(config, rpc, signer, signer, storage, methodology, journal);
        Map<String, Object> result;
        if (action.equals("evidence")) {
            var body =
                    methodology.evidenceBody(
                            101,
                            beneficiary,
                            Json.str(session.get("sourceEventId")),
                            Map.of("petBottleCount", 3));
            var state =
                    sdk.prepareEvidence(
                            operation,
                            Json.str(session.get("claimId")),
                            beneficiary,
                            "partners/101/activities/1003/" + operation + "/evidence.json",
                            body);
            result =
                    Json.obj(
                            "operationId",
                            operation,
                            "claimId",
                            session.get("claimId"),
                            "upload",
                            state.get("upload"),
                            "methodologyHash",
                            methodology.hash(),
                            "registryAuthority",
                            "RCF_HANDOFF_ACTIVE_SNAPSHOT_2026-10-07");
        } else if (action.equals("sponsored")) {
            sdk.approveClaim(operation);
            result = sdk.prepareSponsored(operation, "900000");
            result.put("operationId", operation);
            result.put("claimId", session.get("claimId"));
        } else if (action.equals("self-paid")) {
            sdk.approveClaim(operation);
            result = sdk.prepareSelfPaid(operation);
            result.put("operationId", operation);
            result.put("claimId", session.get("claimId"));
        } else if (action.equals("submit")) {
            if (!mode.equals("sponsored"))
                throw new IllegalArgumentException("Use resolve for self-paid app transactions");
            String signature =
                    Files.readString(
                                    Path.of(
                                            Objects.requireNonNull(
                                                    System.getenv("DMRVN_USER_SIGNATURE_FILE"))))
                            .strip();
            var state = sdk.operation(operation);
            var forward = Json.map(Json.map(state.get("sponsored")).get("forwardRequest"));
            result = sdk.submitSponsored(operation, forward, signature);
        } else result = sdk.resolveSubmission(operation, System.getenv("DMRVN_SUBMISSION_TX_HASH"));
        Path path = directory.resolve(mode + "-" + action + ".json");
        write(path, result);
        if (action.equals("sponsored") || action.equals("self-paid"))
            System.out.println(
                    Json.canonical(
                            Json.obj(
                                    "operationId",
                                    operation,
                                    "claimId",
                                    session.get("claimId"),
                                    "appRequestFile",
                                    path.toAbsolutePath().toString(),
                                    "requiresAppAction",
                                    true)));
        else System.out.println(Json.canonical(result));
    }

    private static void write(Path path, Map<String, Object> value) throws Exception {
        if (!Files.exists(path))
            Files.createFile(
                    path,
                    PosixFilePermissions.asFileAttribute(
                            PosixFilePermissions.fromString("rw-------")));
        Files.write(path, Json.bytes(value));
    }
}
