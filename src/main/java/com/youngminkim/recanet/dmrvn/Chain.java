package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.math.BigInteger;
import java.util.*;

final class Chain {
    static final String IMPLEMENTATION_SLOT =
            "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    static final String ADMIN_SLOT =
            "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
    static final Abi ADMIN = new Abi("proxy-admin.json");
    final DmrvnConfig config;
    final EvmRpc rpc;

    Chain(DmrvnConfig config, EvmRpc rpc) {
        this.config = config;
        this.rpc = rpc;
    }

    Object call(String method, Object... values) {
        return rpc.call(method, Arrays.asList(values));
    }

    static String quantity(BigInteger n) {
        return "0x" + n.toString(16);
    }

    static String quantity(long n) {
        return quantity(BigInteger.valueOf(n));
    }

    static BigInteger number(Object o) {
        String s = Json.str(o);
        require(s.matches("0x[0-9a-fA-F]+"), Code.RPC_UNAVAILABLE);
        return new BigInteger(s.substring(2), 16);
    }

    long head() {
        return number(call("eth_blockNumber")).longValueExact();
    }

    long confirmedHead() {
        return Math.max(0, head() - config.confirmations() + 1);
    }

    Map<String, Object> block(long n) {
        return Json.map(call("eth_getBlockByNumber", quantity(n), false));
    }

    long timestamp() {
        return number(Json.map(call("eth_getBlockByNumber", "latest", false)).get("timestamp"))
                .longValueExact();
    }

    Map<String, Object> contract(
            Abi abi, String address, String fn, Map<String, Object> args, String block) {
        try {
            return abi.decodeOutput(
                    fn,
                    Json.str(
                            call(
                                    "eth_call",
                                    Json.obj("to", address, "data", abi.encode(fn, args)),
                                    block)));
        } catch (DmrvnException e) {
            if (e.code() == Code.GAS_ESTIMATION_FAILED)
                throw new DmrvnException(Code.RPC_UNAVAILABLE);
            throw e;
        }
    }

    Object view(String fn, Map<String, Object> args) {
        return contract(DmrvnProtocol.CLAIM, config.claimAddress(), fn, args, "latest")
                .values()
                .iterator()
                .next();
    }

    BigInteger nonce(String address, boolean forwarder) {
        var abi = forwarder ? DmrvnProtocol.FORWARDER : DmrvnProtocol.CLAIM;
        var fields = abi.inputs("nonces");
        return Crypto.uint(
                contract(
                                abi,
                                forwarder ? config.forwarderAddress() : config.claimAddress(),
                                "nonces",
                                Map.of(fields.get(0).name(), address),
                                "latest")
                        .values()
                        .iterator()
                        .next(),
                256);
    }

    Map<String, Object> claim(String id, long block) {
        return Json.map(
                contract(
                                DmrvnProtocol.CLAIM,
                                config.claimAddress(),
                                "getClaim",
                                Map.of("claimId", id),
                                quantity(block))
                        .get(""));
    }

    Map<String, Object> verifyDeployment() {
        try {
            return verifyDeployment(head());
        } catch (RuntimeException e) {
            if (e instanceof UpstreamException) throw e;
            throw deploymentFailure(e);
        }
    }

    Map<String, Object> verifyDeployment(long height) {
        try {
            require(
                    number(call("eth_chainId")).equals(BigInteger.valueOf(config.chainId())),
                    Code.DEPLOYMENT_NOT_READY);
            String tag = quantity(height);
            String blockHash = Crypto.bytes32(Json.str(block(height).get("hash"), "hash"), "hash");
            var deployment = config.deployment();
            var observed = deployment.snapshot();
            var expectedHashes = Json.map(observed.get("codeHashes"), "codeHashes");
            var hashes = new LinkedHashMap<String, Object>();
            String targetKey = deployment.isProxy() ? "proxy" : "contract";
            hashes.put(
                    targetKey,
                    verifyCode(
                            config.claimAddress(),
                            expectedHashes.get(targetKey),
                            tag,
                            Code.DEPLOYMENT_NOT_READY));
            hashes.put(
                    "forwarder",
                    verifyCode(
                            config.forwarderAddress(),
                            expectedHashes.get("forwarder"),
                            tag,
                            Code.DEPLOYMENT_NOT_READY));
            if (deployment.isProxy()) {
                String implementation = slotAddress(IMPLEMENTATION_SLOT, tag);
                var release = deployment.release(implementation);
                require(release != null, Code.UNAPPROVED_IMPLEMENTATION);
                String admin = slotAddress(ADMIN_SLOT, tag);
                require(admin.equals(observed.get("proxyAdminAddress")), Code.DEPLOYMENT_NOT_READY);
                hashes.put(
                        "proxyAdmin",
                        verifyCode(
                                admin,
                                expectedHashes.get("proxyAdmin"),
                                tag,
                                Code.DEPLOYMENT_NOT_READY));
                hashes.put(
                        "implementation",
                        verifyCode(
                                implementation,
                                release.get("codeHash"),
                                tag,
                                Code.UNAPPROVED_IMPLEMENTATION));
                require(
                        release.get("contractVersion")
                                .equals(
                                        contract(
                                                        DmrvnProtocol.CLAIM,
                                                        config.claimAddress(),
                                                        "contractVersion",
                                                        Map.of(),
                                                        tag)
                                                .get("")),
                        Code.UNAPPROVED_IMPLEMENTATION);
                require(
                        observed.get("owner")
                                .equals(contract(ADMIN, admin, "owner", Map.of(), tag).get("")),
                        Code.DEPLOYMENT_NOT_READY);
                observed.put("implementationAddress", implementation);
                observed.put("approvedImplementationHash", release.get("codeHash"));
                observed.put("contractVersion", release.get("contractVersion"));
            }
            verifyDomain(DmrvnProtocol.CLAIM, config.claimAddress(), false, tag);
            verifyDomain(DmrvnProtocol.FORWARDER, config.forwarderAddress(), true, tag);
            var fields = DmrvnProtocol.CLAIM.inputs("isTrustedForwarder");
            require(
                    Boolean.TRUE.equals(
                            contract(
                                            DmrvnProtocol.CLAIM,
                                            config.claimAddress(),
                                            "isTrustedForwarder",
                                            Map.of(fields.get(0).name(), config.forwarderAddress()),
                                            tag)
                                    .get("")),
                    Code.DEPLOYMENT_NOT_READY);
            require(blockHash.equals(block(height).get("hash")), Code.DEPLOYMENT_NOT_READY);
            observed.put("codeHashes", hashes);
            observed.put("verified", true);
            observed.put("observedBlock", height);
            observed.put("observedBlockHash", blockHash);
            return observed;
        } catch (RuntimeException e) {
            throw deploymentFailure(e);
        }
    }

    private static RuntimeException deploymentFailure(RuntimeException error) {
        if (!(error instanceof DmrvnException)) return error;
        return error instanceof DmrvnException e && e.code() == Code.UNAPPROVED_IMPLEMENTATION
                ? e
                : new DmrvnException(Code.DEPLOYMENT_NOT_READY);
    }

    private String slotAddress(String slot, String tag) {
        String value = Json.str(call("eth_getStorageAt", config.claimAddress(), slot, tag));
        require(value.matches("0x0{24}[0-9a-fA-F]{40}"), Code.DEPLOYMENT_NOT_READY);
        return DmrvnDeployment.address("0x" + value.substring(26));
    }

    private String verifyCode(String address, Object expected, String tag, Code failure) {
        byte[] code = Crypto.hex(Json.str(call("eth_getCode", address, tag)));
        String hash = Crypto.hash(code);
        require(code.length > 0 && hash.equals(expected), failure);
        return hash;
    }

    private void verifyDomain(Abi abi, String address, boolean forwarder, String tag) {
        var actual = contract(abi, address, "eip712Domain", Map.of(), tag);
        var expected = DmrvnProtocol.domain(config.chainId(), address, forwarder);
        for (String field : List.of("name", "version", "chainId", "verifyingContract"))
            require(
                    String.valueOf(expected.get(field)).equals(String.valueOf(actual.get(field))),
                    Code.DEPLOYMENT_NOT_READY);
        require(
                "0x0f".equals(actual.get("fields"))
                        && Crypto.ZERO.equals(actual.get("salt"))
                        && Json.list(actual.get("extensions"), "extensions").isEmpty(),
                Code.DEPLOYMENT_NOT_READY);
    }

    void verifyApprover(String address) {
        Object role = view("CLAIM_APPROVER_ROLE", Map.of());
        require(
                Boolean.TRUE.equals(view("hasRole", Json.obj("role", role, "account", address))),
                Code.UNAUTHORIZED_SIGNER);
    }

    Map<String, Object> receipt(String hash, long head) {
        Object raw = call("eth_getTransactionReceipt", hash);
        if (raw == null) return null;
        var r = Json.map(raw);
        long height = number(r.get("blockNumber")).longValueExact();
        if (height > head) return null;
        require(Json.str(r.get("transactionHash"), "transactionHash").equalsIgnoreCase(hash),
                Code.SUBMISSION_UNRESOLVED, "receipt.transactionHash", "must match the requested transaction hash");
        require(Objects.equals(block(height).get("hash"), r.get("blockHash")),
                Code.SUBMISSION_UNRESOLVED, "receipt.blockHash", "must match the canonical block hash");
        return r;
    }

    Map<String, Object> event(String name, Map<String, Object> receipt, String claimId) {
        for (Object raw : Json.list(receipt.get("logs"), "logs")) {
            var log = Json.map(raw);
            if (!config.claimAddress().equalsIgnoreCase(String.valueOf(log.get("address"))))
                continue;
            var topics = Json.list(log.get("topics"), "topics");
            if (topics.isEmpty() || !DmrvnProtocol.CLAIM.topic(name).equals(topics.get(0)))
                continue;
            var e = DmrvnProtocol.CLAIM.decodeEvent(name, log);
            if (claimId.equalsIgnoreCase(Json.str(e.get("claimId"), "claimId"))) return e;
        }
        return null;
    }

    String findTransaction(
            String event, String id, long from, long to, String field, String expected) {
        require(from >= 0 && from <= to && to - from <= 100000, Code.REPORT_LOOKUP_RANGE);
        for (long start = from; start <= to; start += 1000) {
            var filter =
                    Json.obj(
                            "address",
                            config.claimAddress(),
                            "fromBlock",
                            quantity(start),
                            "toBlock",
                            quantity(Math.min(to, start + 999)),
                            "topics",
                            List.of(DmrvnProtocol.CLAIM.topic(event), id));
            for (Object item : Json.list(call("eth_getLogs", filter))) {
                var log = Json.map(item);
                require(
                        config.claimAddress().equalsIgnoreCase(Json.str(log.get("address"), "address"))
                                && !Boolean.TRUE.equals(log.get("removed")),
                        Code.RPC_UNAVAILABLE);
                var decoded = DmrvnProtocol.CLAIM.decodeEvent(event, log);
                if (id.equalsIgnoreCase(Json.str(decoded.get("claimId"), "claimId"))
                        && expected.equals(String.valueOf(decoded.get(field))))
                    return Json.str(log.get("transactionHash"), "transactionHash");
            }
        }
        return null;
    }
}
