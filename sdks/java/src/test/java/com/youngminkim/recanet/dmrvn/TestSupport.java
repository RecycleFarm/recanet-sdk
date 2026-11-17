package com.youngminkim.recanet.dmrvn;

import org.bouncycastle.crypto.digests.SHA256Digest;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.crypto.params.*;
import org.bouncycastle.crypto.signers.*;

import java.math.BigInteger;
import java.util.*;

final class TestSupport {
    static class Signer implements EvmSigner {
        final BigInteger key;
        final String address;
        int messages, typed, sends;
        String sentData;
        RuntimeException failure;

        Signer(int scalar) {
            this(BigInteger.valueOf(scalar));
        }

        Signer(BigInteger scalar) {
            key = scalar;
            byte[] publicKey =
                    CustomNamedCurves.getByName("secp256k1").getG().multiply(key).getEncoded(false);
            address =
                    "0x"
                            + Crypto.hash(Arrays.copyOfRange(publicKey, 1, publicKey.length))
                                    .substring(26);
        }

        public String address() {
            return address;
        }

        String sign(String digest) {
            var c = CustomNamedCurves.getByName("secp256k1");
            var signer = new ECDSASigner(new HMacDSAKCalculator(new SHA256Digest()));
            signer.init(
                    true,
                    new ECPrivateKeyParameters(
                            key,
                            new ECDomainParameters(c.getCurve(), c.getG(), c.getN(), c.getH())));
            var rs = signer.generateSignature(Crypto.hex(digest));
            if (rs[1].compareTo(c.getN().shiftRight(1)) > 0) rs[1] = c.getN().subtract(rs[1]);
            for (int v = 27; v <= 28; v++) {
                String sig =
                        Crypto.hex(
                                Crypto.join(
                                        Crypto.word(rs[0]),
                                        Crypto.word(rs[1]),
                                        new byte[] {(byte) v}));
                if (Crypto.recover(digest, sig).equals(address)) return sig;
            }
            throw new AssertionError();
        }

        public String signMessage(String message) {
            messages++;
            return sign(Crypto.messageDigest(message));
        }

        public String signTypedData(Map<String, Object> data) {
            typed++;
            return sign(
                    DmrvnProtocol.digest(
                            Json.str(data.get("primaryType")),
                            Json.map(data.get("domain")),
                            Json.map(data.get("message"))));
        }

        public String sendTransaction(long chain, Map<String, Object> tx, String key) {
            sends++;
            sentData = Json.str(tx.get("data"));
            if (failure != null) throw failure;
            return TX;
        }
    }

    static final String TX = "0x" + "ab".repeat(32), BLOCK = "0x" + "cd".repeat(32);

    static class Storage implements GreenfieldStorage {
        boolean exists, sealed, loseCreate;
        int creates, uploads, reads;
        byte[] bytes;
        Map<String, byte[]> objects = new HashMap<>();
        Set<String> seals = new HashSet<>();

        public String address() {
            return new Signer(9).address();
        }

        public String chainId() {
            return "5600";
        }

        public Head head(Map<String, Object> location) {
            String name = Json.str(location.get("objectName"));
            return objects.isEmpty()
                    ? new Head(exists, sealed)
                    : new Head(objects.containsKey(name), seals.contains(name));
        }

        public String create(Map<String, Object> location, byte[] data) {
            creates++;
            exists = true;
            bytes = data.clone();
            objects.put(Json.str(location.get("objectName")), bytes);
            if (loseCreate) throw new DmrvnException(DmrvnException.Code.STORAGE_UNAVAILABLE);
            return "ab".repeat(32);
        }

        public void upload(Map<String, Object> location, byte[] data, String hash) {
            uploads++;
            sealed = true;
            bytes = data.clone();
            String name = Json.str(location.get("objectName"));
            objects.put(name, bytes);
            seals.add(name);
        }

        public byte[] read(Map<String, Object> location) {
            reads++;
            return objects.getOrDefault(Json.str(location.get("objectName")), bytes).clone();
        }

        public boolean matchesCreateTransaction(Map<String, Object> location, String hash) {
            return exists && hash.equals("ab".repeat(32));
        }
    }

    static Map<String, Object> log(
            Abi abi, String name, String address, Map<String, Object> event) {
        var topics = new ArrayList<Object>();
        topics.add(abi.topic(name));
        var normal = new ArrayList<Abi.Field>();
        for (Object raw : Json.list(abi.definition(name).get("inputs"))) {
            var m = Json.map(raw);
            var field = Abi.fields(List.of(raw)).get(0);
            if (Boolean.TRUE.equals(m.get("indexed")))
                topics.add(Crypto.hex(Abi.tuple(List.of(field), event)));
            else normal.add(field);
        }
        return Json.obj(
                "address",
                address,
                "topics",
                topics,
                "data",
                Crypto.hex(Abi.tuple(normal, event)),
                "transactionHash",
                TX,
                "blockNumber",
                "0x64",
                "blockHash",
                BLOCK,
                "removed",
                false);
    }

    static class Rpc implements EvmRpc {
        final DmrvnConfig config;
        String implementation = "0x3333333333333333333333333333333333333333";
        String version = "1.0.0";
        BigInteger claimNonce = BigInteger.valueOf(7);
        long timestamp = 1999999100;
        boolean role = true;
        Map<String, Object> claim, tx, receipt;
        boolean simulationFailure;

        Rpc() throws Exception {
            this(ReportVerifierTest.config());
        }

        Rpc(DmrvnConfig config) throws Exception {
            this.config = config;
            claim = ReportVerifierTest.stored(DmrvnProtocolTest.fixture());
            claim.put("status", 0);
        }

        public Object call(String method, List<Object> p) {
            return switch (method) {
                case "eth_chainId" -> "0x66eee";
                case "eth_getCode" -> "0x01";
                case "eth_getStorageAt" -> "0x"
                        + "0".repeat(24)
                        + (p.get(1).equals(Chain.ADMIN_SLOT)
                                ? "4444444444444444444444444444444444444444"
                                : implementation.substring(2));
                case "eth_blockNumber" -> "0x64";
                case "eth_getBlockByNumber" -> Json.obj(
                        "timestamp", Chain.quantity(timestamp), "hash", BLOCK);
                case "eth_getBalance" -> "0xde0b6b3a7640000";
                case "eth_gasPrice" -> "0x1";
                case "eth_getTransactionCount" -> "0x0";
                case "eth_estimateGas" -> {
                    if (simulationFailure)
                        throw new DmrvnException(DmrvnException.Code.GAS_ESTIMATION_FAILED);
                    yield "0xf4240";
                }
                case "eth_getTransactionReceipt" -> receipt;
                case "eth_getTransactionByHash" -> tx;
                case "eth_getLogs" -> receipt == null ? List.of() : receipt.get("logs");
                case "eth_call" -> contract(Json.map(p.get(0)));
                default -> throw new AssertionError(method);
            };
        }

        Object contract(Map<String, Object> tx) {
            String data = Json.str(tx.get("data"));
            if (data.startsWith(Chain.ADMIN.topic("owner").substring(0, 10)))
                return Crypto.hex(
                        Abi.tuple(
                                Chain.ADMIN.outputs("owner"),
                                Map.of("", "0x5555555555555555555555555555555555555555")));
            boolean forward = config.forwarderAddress().equals(tx.get("to"));
            Abi abi = forward ? DmrvnProtocol.FORWARDER : DmrvnProtocol.CLAIM;
            if (data.startsWith(abi.topic("eip712Domain").substring(0, 10))) {
                var domain = DmrvnProtocol.domain(config.chainId(), config.claimAddress(), false);
                if (forward)
                    domain =
                            DmrvnProtocol.domain(config.chainId(), config.forwarderAddress(), true);
                domain.put("fields", "0x0f");
                domain.put("salt", Crypto.ZERO);
                domain.put("extensions", List.of());
                return Crypto.hex(Abi.tuple(abi.outputs("eip712Domain"), domain));
            }
            if (!forward && data.startsWith(abi.topic("contractVersion").substring(0, 10)))
                return Crypto.hex(Abi.tuple(abi.outputs("contractVersion"), Map.of("", version)));
            for (String name :
                    forward
                            ? List.of("nonces", "verify", "execute")
                            : List.of(
                                    "nonces",
                                    "getClaim",
                                    "isTrustedForwarder",
                                    "CLAIM_APPROVER_ROLE",
                                    "hasRole")) {
                if (!data.startsWith(abi.topic(name).substring(0, 10))) continue;
                Object output =
                        switch (name) {
                            case "getClaim" -> claim;
                            case "nonces" -> forward ? "11" : claimNonce.toString();
                            case "CLAIM_APPROVER_ROLE" -> Crypto.textHash("CLAIM_APPROVER_ROLE");
                            case "hasRole" -> role;
                            case "isTrustedForwarder", "verify" -> true;
                            default -> null;
                        };
                if (name.equals("execute")) return "0x";
                var out = abi.outputs(name);
                return Crypto.hex(Abi.tuple(out, Map.of(out.get(0).name(), output)));
            }
            throw new AssertionError("Unknown calldata");
        }

        void confirm(
                Map<String, Object> approved,
                Map<String, Object> sponsored,
                String signature,
                String relay) {
            var r = Json.map(approved.get("claimRequest"));
            claim = Json.copy(r);
            claim.remove("claimId");
            claim.remove("nonce");
            claim.remove("deadline");
            claim.put("approver", new Signer(2).address());
            claim.put("status", 1);
            claim.put("outputHash", Crypto.ZERO);
            claim.put("reportHash", Crypto.ZERO);
            claim.put(
                    "evidenceLocationHash",
                    DmrvnProtocol.evidenceLocationHash(Json.map(r.get("evidenceLocation"))));
            claim.put("requestedAt", "1999999100");
            claim.put("finalizedAt", "0");
            var logs = new ArrayList<Object>();
            logs.add(log(DmrvnProtocol.CLAIM, "MrvClaimRequested", config.claimAddress(), r));
            String target = config.claimAddress(),
                    sender = Json.str(r.get("beneficiary")),
                    data = DmrvnProtocol.submitCalldata(approved);
            if (sponsored != null) {
                var f = Json.map(sponsored.get("forwardRequest"));
                target = config.forwarderAddress();
                sender = relay;
                data = DmrvnProtocol.executeCalldata(f, signature);
                logs.add(
                        log(
                                DmrvnProtocol.FORWARDER,
                                "ExecutedForwardRequest",
                                target,
                                Json.obj(
                                        "signer",
                                        r.get("beneficiary"),
                                        "nonce",
                                        f.get("nonce"),
                                        "success",
                                        true)));
            }
            receipt =
                    Json.obj(
                            "transactionHash",
                            TX,
                            "blockHash",
                            BLOCK,
                            "blockNumber",
                            "0x64",
                            "status",
                            "0x1",
                            "to",
                            target,
                            "from",
                            sender,
                            "logs",
                            logs);
            tx =
                    Json.obj(
                            "hash",
                            TX,
                            "blockHash",
                            BLOCK,
                            "to",
                            target,
                            "from",
                            sender,
                            "input",
                            data,
                            "value",
                            "0x0");
            claimNonce = claimNonce.add(BigInteger.ONE);
        }
    }

    static Map<String, Object> proxyManifest() {
        String hash = Crypto.hash(Crypto.hex("0x01"));
        return Json.obj(
                "chainId",
                421614,
                "proxy",
                "0x1111111111111111111111111111111111111111",
                "forwarder",
                "0x2222222222222222222222222222222222222222",
                "implementation",
                "0x3333333333333333333333333333333333333333",
                "proxyAdmin",
                "0x4444444444444444444444444444444444444444",
                "owner",
                "0x5555555555555555555555555555555555555555",
                "domainVersion",
                "7",
                "contractVersion",
                "1.0.0",
                "codeHashes",
                Json.obj(
                        "proxy",
                        hash,
                        "implementation",
                        hash,
                        "forwarder",
                        hash,
                        "proxyAdmin",
                        hash),
                "approvedReleases",
                List.of(
                        Json.obj(
                                "address",
                                "0x6666666666666666666666666666666666666666",
                                "codeHash",
                                hash,
                                "contractVersion",
                                "1.0.1")));
    }

    static DmrvnConfig proxyConfig() {
        return proxyConfig(proxyManifest());
    }

    static DmrvnConfig proxyConfig(Map<String, Object> manifest) {
        return DmrvnConfig.fromDeployment(
                DmrvnDeployment.fromManifest(manifest),
                java.net.URI.create("https://example.com"),
                "5600",
                "offline-fixture",
                "partners/101/",
                101,
                BigInteger.TEN.pow(18),
                1);
    }

    static DeclaredMethodology methodology() throws Exception {
        try (var manifest = TestSupport.class.getResourceAsStream("/dmrvn/pet-manifest.json");
                var wasm = TestSupport.class.getResourceAsStream("/dmrvn/pet-methodology.wasm")) {
            return new DeclaredMethodology(
                    manifest.readAllBytes(),
                    wasm.readAllBytes(),
                    DeclaredMethodology.PET_HASH,
                    (a, id, v, h) -> true);
        }
    }
}
