package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;

import com.youngminkim.recanet.dmrvn.*;
import java.math.BigInteger;
import java.util.*;
import org.junit.jupiter.api.Test;

class AssetClientTest {
    private static final String ADDRESS = "0x" + "12".repeat(20);
    private static final String RECIPIENT = "0x" + "34".repeat(20);
    private static final String HASH = "0x" + "ab".repeat(32);

    @Test void balanceAndTransferUseFixedChainAndExactWei() {
        var calls = new ArrayList<String>();
        EvmRpc rpc = (method, params) -> {
            calls.add(method);
            return switch (method) {
                case "eth_chainId" -> "0x66eee";
                case "eth_getBalance" -> { assertEquals(List.of(ADDRESS, "latest"), params); yield "0x20000000000001"; }
                case "eth_estimateGas" -> { assertEquals("0x20000000000001", ((Map<?, ?>) params.get(0)).get("value")); yield "0x5208"; }
                case "eth_gasPrice" -> "0x5";
                case "eth_getTransactionCount" -> { assertEquals(List.of(ADDRESS, "pending"), params); yield "0x3"; }
                default -> throw new AssertionError(method);
            };
        };
        EvmSigner signer = new EvmSigner() {
            public String address() { return ADDRESS; }
            public String signMessage(String message) { throw new AssertionError(); }
            public String signTypedData(Map<String, Object> data) { throw new AssertionError(); }
            public String sendTransaction(long chain, Map<String, Object> tx, String key) {
                assertEquals(421614, chain); assertEquals("transfer-1", key);
                assertEquals(Map.of("to", RECIPIENT, "value", "0x20000000000001", "data", "0x", "gas", "0x5208", "gasPrice", "0x5", "nonce", "0x3"), tx);
                return HASH;
            }
        };
        var client = new AssetClient(rpc);
        var amount = new BigInteger("20000000000001", 16);
        assertEquals(amount, client.getBalance(ADDRESS));
        assertEquals(HASH, client.transfer(signer, RECIPIENT, amount, "transfer-1"));
        assertEquals(List.of("eth_chainId", "eth_getBalance", "eth_chainId", "eth_estimateGas", "eth_gasPrice", "eth_getTransactionCount"), calls);
    }

    @Test void rejectsWrongChainAndInvalidInput() {
        var client = new AssetClient((method, params) -> "0x1");
        assertEquals(DmrvnException.Code.WRONG_CHAIN, assertThrows(DmrvnException.class, () -> client.getBalance(ADDRESS)).code());
        assertThrows(IllegalArgumentException.class, () -> client.getBalance("bad"));
        EvmSigner signer = new EvmSigner() {
            public String address() { return ADDRESS; }
            public String signMessage(String m) { return null; }
            public String signTypedData(Map<String, Object> d) { return null; }
            public String sendTransaction(long c, Map<String, Object> t, String k) { throw new AssertionError(); }
        };
        assertThrows(IllegalArgumentException.class, () -> client.transfer(signer, RECIPIENT, BigInteger.ZERO, "id"));
        assertThrows(IllegalArgumentException.class, () -> client.transfer(signer, RECIPIENT, BigInteger.ONE, " "));
        assertEquals(DmrvnException.Code.WRONG_CHAIN, assertThrows(DmrvnException.class, () -> client.transfer(signer, RECIPIENT, BigInteger.ONE, "id")).code());
        assertEquals(DmrvnException.Code.RPC_UNAVAILABLE, assertThrows(DmrvnException.class, () -> new AssetClient((m,p) -> "0x00").getBalance(ADDRESS)).code());
    }
    @Test void submissionFailurePreservesOriginalCode() {
        var client = new AssetClient((method, params) -> switch (method) {
            case "eth_chainId" -> "0x66eee";
            default -> "0x1";
        });
        EvmSigner signer = new EvmSigner() {
            public String address() { return ADDRESS; }
            public String signMessage(String m) { return null; }
            public String signTypedData(Map<String, Object> d) { return null; }
            public String sendTransaction(long c, Map<String, Object> t, String k) { throw new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE); }
        };
        assertEquals(DmrvnException.Code.RPC_UNAVAILABLE,
                assertThrows(DmrvnException.class, () -> client.transfer(signer, RECIPIENT, BigInteger.ONE, "id")).code());
    }

}
