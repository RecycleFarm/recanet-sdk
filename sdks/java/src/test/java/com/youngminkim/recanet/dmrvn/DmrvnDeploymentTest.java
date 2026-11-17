package com.youngminkim.recanet.dmrvn;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

import java.util.*;

class DmrvnDeploymentTest {
    @Test
    void bundledProxyAndHistoricalDirectHaveDistinctIdentityAndVersionMeaning() {
        var proxy = DmrvnDeployment.testnet();
        assertEquals("0x5984b6c7773031497aca9bf0c7c1155bdeaed24e", proxy.contractAddress());
        assertEquals("7", proxy.snapshot().get("protocolVersion"));
        assertEquals("1.0.1", proxy.snapshot().get("contractVersion"));
        var direct = DmrvnDeployment.historicalDirectTestnet();
        assertNull(direct.snapshot().get("contractVersion"));
        assertEquals(false, direct.snapshot().get("contractVersionSupported"));
        assertNotEquals(direct.contractAddress(), proxy.contractAddress());
        assertThrows(DmrvnException.class, direct::requireWritable);
    }

    @Test
    void actualSlotSelectsApprovedReleaseAndAllReadsUseOneBlock() throws Exception {
        var rpc = new TestSupport.Rpc(TestSupport.proxyConfig());
        var calls = new ArrayList<String>();
        EvmRpc recorded =
                (method, params) -> {
                    if (Set.of("eth_call", "eth_getCode", "eth_getStorageAt").contains(method)) {
                        calls.add(method);
                        assertEquals("0x64", params.get(params.size() - 1));
                    }
                    return rpc.call(method, params);
                };
        var chain = new Chain(rpc.config, recorded);
        var initial = chain.verifyDeployment();
        assertEquals("1.0.0", initial.get("contractVersion"));
        assertEquals(4, Collections.frequency(calls, "eth_getCode"));
        assertEquals(2, Collections.frequency(calls, "eth_getStorageAt"));
        rpc.implementation = "0x6666666666666666666666666666666666666666";
        rpc.version = "1.0.1";
        var observed = chain.verifyDeployment();
        assertEquals("1.0.1", observed.get("contractVersion"));
        assertEquals(rpc.implementation, observed.get("implementationAddress"));
        assertEquals("1.0.0", initial.get("contractVersion"));
        assertEquals(100L, observed.get("observedBlock"));
        rpc.config.deployment().assertCompatible(initial);
    }

    @Test
    void everyReadinessMismatchFailsClosed() throws Exception {
        var config = TestSupport.proxyConfig();
        for (String variant :
                List.of(
                        "chain",
                        "proxy-code",
                        "forwarder-code",
                        "admin-code",
                        "implementation-code",
                        "implementation-slot",
                        "admin-slot",
                        "slot-padding",
                        "empty-code",
                        "version",
                        "owner",
                        "claim-domain",
                        "forwarder-domain",
                        "domain-name",
                        "domain-chain",
                        "domain-verifier",
                        "domain-fields",
                        "trusted",
                        "rpc",
                        "reorg")) {
            var rpc = new TestSupport.Rpc(config);
            int[] blocks = {0};
            EvmRpc bad =
                    (method, params) -> {
                        if (variant.equals("rpc"))
                            throw new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
                        if (variant.equals("chain") && method.equals("eth_chainId")) return "0x1";
                        if (variant.equals("reorg")
                                && method.equals("eth_getBlockByNumber")
                                && ++blocks[0] == 2) return Json.obj("hash", Crypto.ZERO);
                        if (method.equals("eth_getCode")) {
                            String target =
                                    switch (variant) {
                                        case "proxy-code", "empty-code" -> config.claimAddress();
                                        case "forwarder-code" -> config.forwarderAddress();
                                        case "admin-code" -> "0x4444444444444444444444444444444444444444";
                                        case "implementation-code" -> rpc.implementation;
                                        default -> "";
                                    };
                            if (params.get(0).equals(target))
                                return variant.equals("empty-code") ? "0x" : "0x02";
                        }
                        if (method.equals("eth_getStorageAt")) {
                            if (variant.equals("slot-padding")) return "0x01" + "00".repeat(31);
                            if ((variant.equals("implementation-slot")
                                            && params.get(1).equals(Chain.IMPLEMENTATION_SLOT))
                                    || (variant.equals("admin-slot")
                                            && params.get(1).equals(Chain.ADMIN_SLOT)))
                                return "0x" + "0".repeat(24) + "77".repeat(20);
                        }
                        Object original = rpc.call(method, params);
                        if (!method.equals("eth_call")) return original;
                        var tx = Json.map(params.get(0));
                        String data = Json.str(tx.get("data"));
                        boolean forward = tx.get("to").equals(config.forwarderAddress());
                        Abi abi = forward ? DmrvnProtocol.FORWARDER : DmrvnProtocol.CLAIM;
                        if (data.startsWith(abi.topic("eip712Domain").substring(0, 10))) {
                            var domain = abi.decodeOutput("eip712Domain", Json.str(original));
                            switch (variant) {
                                case "claim-domain" -> {
                                    if (!forward) domain.put("version", "1.0.1");
                                }
                                case "forwarder-domain" -> {
                                    if (forward) domain.put("version", "7");
                                }
                                case "domain-name" -> domain.put("name", "Other");
                                case "domain-chain" -> domain.put("chainId", "1");
                                case "domain-verifier" -> domain.put(
                                        "verifyingContract", rpc.implementation);
                                case "domain-fields" -> domain.put("fields", "0x00");
                            }
                            return Crypto.hex(Abi.tuple(abi.outputs("eip712Domain"), domain));
                        }
                        if (variant.equals("owner")
                                && data.startsWith(Chain.ADMIN.topic("owner").substring(0, 10)))
                            return Crypto.hex(
                                    Abi.tuple(
                                            Chain.ADMIN.outputs("owner"),
                                            Map.of("", rpc.implementation)));
                        if (!forward
                                && variant.equals("version")
                                && data.startsWith(abi.topic("contractVersion").substring(0, 10)))
                            return Crypto.hex(
                                    Abi.tuple(abi.outputs("contractVersion"), Map.of("", "1.0.1")));
                        if (!forward
                                && variant.equals("trusted")
                                && data.startsWith(
                                        abi.topic("isTrustedForwarder").substring(0, 10)))
                            return Crypto.hex(
                                    Abi.tuple(
                                            abi.outputs("isTrustedForwarder"), Map.of("", false)));
                        return original;
                    };
            var error =
                    assertThrows(
                            DmrvnException.class,
                            () -> new Chain(config, bad).verifyDeployment(),
                            variant);
            assertEquals(
                    variant.startsWith("implementation-") || variant.equals("version")
                            ? DmrvnException.Code.UNAPPROVED_IMPLEMENTATION
                            : DmrvnException.Code.DEPLOYMENT_NOT_READY,
                    error.code(),
                    variant);
        }
    }

    @Test
    void malformedManifestsAndConflictingApprovalsAreRejected() {
        for (String variant :
                List.of(
                        "missing-hash",
                        "chain",
                        "domain",
                        "forwarder-domain",
                        "version",
                        "conflict",
                        "target",
                        "admin-target",
                        "zero")) {
            var m = TestSupport.proxyManifest();
            switch (variant) {
                case "missing-hash" -> Json.map(m.get("codeHashes")).remove("forwarder");
                case "chain" -> m.put("chainId", "9007199254740992");
                case "domain" -> m.put("domainVersion", "1.0.1");
                case "forwarder-domain" -> m.put("forwarderDomainVersion", "7");
                case "version" -> m.put("contractVersion", "7");
                case "target" -> m.put("proxy", m.get("implementation"));
                case "admin-target" -> m.put("proxy", m.get("proxyAdmin"));
                case "zero" -> m.put("owner", "0x" + "00".repeat(20));
                case "conflict" -> m.put(
                        "approvedReleases",
                        List.of(
                                Json.obj(
                                        "address",
                                        m.get("implementation"),
                                        "codeHash",
                                        Crypto.textHash("different"),
                                        "contractVersion",
                                        "1.0.0")));
            }
            assertEquals(
                    DmrvnException.Code.DEPLOYMENT_NOT_READY,
                    assertThrows(
                                    DmrvnException.class,
                                    () -> DmrvnDeployment.fromManifest(m),
                                    variant)
                            .code());
        }
        var m = TestSupport.proxyManifest();
        m.put("chainId", "421614");
        assertEquals(421614, DmrvnDeployment.fromManifest(m).chainId());
    }

    @Test
    void historicalDirectDoesNotProbeVersionOrProxySlots() throws Exception {
        var rpc = new TestSupport.Rpc();
        EvmRpc recorded =
                (method, params) -> {
                    assertNotEquals("eth_getStorageAt", method);
                    if (method.equals("eth_call"))
                        assertFalse(
                                Json.str(Json.map(params.get(0)).get("data"))
                                        .startsWith(
                                                DmrvnProtocol.CLAIM
                                                        .topic("contractVersion")
                                                        .substring(0, 10)));
                    return rpc.call(method, params);
                };
        var observed = new Chain(rpc.config, recorded).verifyDeployment();
        assertNull(observed.get("contractVersion"));
        assertEquals(false, observed.get("contractVersionSupported"));
        assertEquals("7", observed.get("protocolVersion"));
    }
}
