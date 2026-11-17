package com.youngminkim.recanet.dmrvn;

import com.youngminkim.recanet.*;

import java.math.BigInteger;
import java.net.URI;
import java.util.*;

/** Read-only diagnostics for the explicitly configured testnet partner. */
public final class DmrvnDiagnostics {
    static DmrvnConfig configuration() {
        String selection = System.getenv().getOrDefault("DMRVN_DEPLOYMENT", "proxy");
        var deployment =
                switch (selection) {
                    case "proxy" -> DmrvnDeployment.testnet();
                    case "direct-v7" -> DmrvnDeployment.historicalDirectTestnet();
                    default -> throw new IllegalArgumentException(
                            "DMRVN_DEPLOYMENT must be proxy or direct-v7");
                };
        String manifestPath = System.getenv("DMRVN_DEPLOYMENT_MANIFEST");
        if (manifestPath != null && !manifestPath.isBlank()) {
            try {
                deployment =
                        DmrvnDeployment.fromManifest(
                                Json.object(
                                        java.nio.file.Files.readAllBytes(
                                                java.nio.file.Path.of(manifestPath))));
            } catch (java.io.IOException e) {
                throw new DmrvnException(DmrvnException.Code.DEPLOYMENT_NOT_READY);
            }
        }
        return DmrvnConfig.fromDeployment(
                deployment,
                URI.create("https://sepolia-rollup.arbitrum.io/rpc"),
                "5600",
                "dmrvn",
                "partners/101/",
                101,
                new BigInteger("1000000000000000"),
                1);
    }

    public static void main(String[] args) {
        String address =
                System.getenv()
                        .getOrDefault(
                                "DMRVN_APPROVER_ADDRESS",
                                "0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77");
        var config = configuration();
        var rpc = new HttpEvmRpc(config.rpcUrl());
        var chain = new Chain(config, rpc);
        var result = new LinkedHashMap<String, Object>();
        result.put("deploymentId", config.deploymentId());
        result.put("partnerId", 101);
        result.put("address", address);
        try {
            if (args[0].equals("wallet") || args[0].equals("sign")) {
                var client =
                        new PrivyClient(
                                new PrivyClientConfig(
                                        System.getenv("PRIVY_APP_ID"),
                                        System.getenv("PRIVY_APP_SECRET")));
                var keys = BackendWalletRegistration.fromEnvironment();
                var matching =
                        client.listWalletsByAuthorizationKey(keys.publicKey()).stream()
                                .filter(w -> address.equalsIgnoreCase(w.address()))
                                .toList();
                result.put(
                        "wallets",
                        matching.stream()
                                .map(
                                        w ->
                                                Map.of(
                                                        "walletId",
                                                        w.id(),
                                                        "address",
                                                        w.address(),
                                                        "chainType",
                                                        w.chainType()))
                                .toList());
                if (args[0].equals("sign")) {
                    var signer = new PrivyEvmSigner(client, matching.get(0).id(), keys);
                    String message =
                            "Recanet DMRVN SDK signing diagnostic (no transaction): "
                                    + UUID.randomUUID();
                    String recovered =
                            Crypto.recover(
                                    Crypto.messageDigest(message), signer.signMessage(message));
                    result.put("personalSignRecovered", recovered);
                    var request =
                            Json.obj(
                                    "claimId",
                                    Crypto.textHash(message),
                                    "beneficiary",
                                    address,
                                    "partnerId",
                                    101,
                                    "activityId",
                                    1003,
                                    "methodologyId",
                                    2003,
                                    "methodologyVersion",
                                    1,
                                    "evidenceHash",
                                    Crypto.textHash(message),
                                    "methodologyHash",
                                    DeclaredMethodology.PET_HASH,
                                    "evidenceLocation",
                                    Json.obj(
                                            "storageType",
                                            1,
                                            "chainId",
                                            "5600",
                                            "bucketName",
                                            "dmrvn",
                                            "objectName",
                                            "partners/101/diagnostic-never-submit.json"),
                                    "nonce",
                                    "0",
                                    "deadline",
                                    "1");
                    var domain =
                            DmrvnProtocol.domain(config.chainId(), config.claimAddress(), false);
                    String signature =
                            signer.signTypedData(
                                    DmrvnProtocol.typedData("ClaimRequest", domain, request));
                    result.put(
                            "typedDataRecovered",
                            Crypto.recover(
                                    DmrvnProtocol.digest("ClaimRequest", domain, request),
                                    signature));
                    result.put("expiredNonExecutableClaim", true);
                    if (!recovered.equalsIgnoreCase(address)
                            || !result.get("typedDataRecovered")
                                    .toString()
                                    .equalsIgnoreCase(address))
                        throw new DmrvnException(DmrvnException.Code.SIGNATURE_INVALID);
                }
            } else if (args[0].equals("read")) {
                var reader =
                        new DmrvnReader(
                                config,
                                rpc,
                                new GreenfieldPublicReader(
                                        URI.create("https://gnfd-testnet-sp1.bnbchain.org"),
                                        "5600"),
                                DmrvnReader.defaultReportResolver("5600", "dmrvn"));
                String id =
                        Objects.requireNonNull(
                                System.getenv("DMRVN_READ_CLAIM_ID"), "DMRVN_READ_CLAIM_ID");
                result.put(
                        "result",
                        reader.readResult(
                                id, null, System.getenv("DMRVN_READ_REPORT_TX_HASH"), false, null));
            } else {
                result.put("verifiedMetadata", chain.verifyDeployment());
                result.put("deployment", "MATCHED");
                result.put(
                        "relayBalanceWei",
                        Chain.number(chain.call("eth_getBalance", address, "latest")).toString());
                try {
                    chain.verifyApprover(address);
                    result.put("claimApproverRole", true);
                } catch (DmrvnException e) {
                    result.put("claimApproverRole", e.code().name());
                }
                var publicReader =
                        new GreenfieldPublicReader(
                                URI.create("https://gnfd-testnet-sp1.bnbchain.org"), "5600");
                try (var stream =
                        DmrvnDiagnostics.class.getResourceAsStream("/dmrvn/pet-publication.json")) {
                    var publication = Json.object(stream.readAllBytes());
                    for (String name : List.of("manifestPointer", "wasmPointer")) {
                        var pointer = Json.copy(Json.map(publication.get(name)));
                        pointer.put("storageType", 1);
                        pointer.put("chainId", "5600");
                        byte[] bytes = publicReader.read(pointer);
                        String hash =
                                name.equals("manifestPointer")
                                        ? Json.hash(Json.parse(bytes))
                                        : Crypto.hash(bytes);
                        result.put(name + "Hash", hash);
                        if (!hash.equals(
                                publication.get(
                                        name.equals("manifestPointer")
                                                ? "methodologyHash"
                                                : "wasmHash")))
                            throw new DmrvnException(DmrvnException.Code.METHODOLOGY_UNAVAILABLE);
                    }
                }
                result.put("methodologyPackage", "MATCHED_PUBLIC_STORAGE");
                result.put("registryActive", "REQUIRES_OPERATOR_CONFIRMATION");
            }
        } catch (DmrvnException e) {
            result.put("error", e.code().name());
        } catch (PrivyApiException e) {
            result.put("privyError", e.code().name());
        } catch (Exception e) {
            result.put("error", e.getClass().getSimpleName());
        }
        String output = System.getenv("DMRVN_DIAGNOSTICS_OUTPUT");
        if (output != null)
            try {
                java.nio.file.Files.writeString(
                        java.nio.file.Path.of(output), Json.canonical(result) + "\n");
            } catch (Exception e) {
                throw new IllegalStateException("Cannot save diagnostic evidence");
            }
        if (result.get("result") instanceof Map<?, ?> full) {
            var summary = new LinkedHashMap<String, Object>();
            for (String k :
                    List.of(
                            "claimId",
                            "chainStatus",
                            "reportVerified",
                            "outputs",
                            "reportHash",
                            "reportTxHash",
                            "fileHash",
                            "reportError")) if (full.containsKey(k)) summary.put(k, full.get(k));
            result.put("result", summary);
        }
        System.out.println(Json.canonical(result));
    }
}
