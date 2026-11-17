package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import com.youngminkim.recanet.dmrvn.*;

import org.junit.jupiter.api.Test;

import java.net.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

class PrivyEvmSignerTest {
    @Test
    void usesAuthorizedWalletFilterAndOfficialRpcWithoutKeyExportOrRetries() throws Exception {
        var registration = BackendWalletKeyPair.generate().registration();
        var requests = new ArrayList<Map<String, Object>>();
        var headers = new ArrayList<String>();
        var failure = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String address = "0x" + "11".repeat(20),
                signature = "0x" + "11".repeat(65),
                txHash = "0x" + "22".repeat(32);
        server.createContext(
                "/v1/wallets",
                exchange -> {
                    String response;
                    if (exchange.getRequestMethod().equals("GET")) {
                        assertTrue(
                                exchange.getRequestURI().getQuery().contains("authorization_key="));
                        // Deliberately different blockchain public_key: ownership comes from the
                        // authorization filter.
                        response =
                                Json.canonical(
                                        Map.of(
                                                "data",
                                                List.of(
                                                        Map.of(
                                                                "id",
                                                                "wallet-test",
                                                                "address",
                                                                address,
                                                                "chain_type",
                                                                "ethereum",
                                                                "public_key",
                                                                "blockchain-public-key",
                                                                "created_at",
                                                                0,
                                                                "policy_ids",
                                                                List.of(),
                                                                "additional_signers",
                                                                List.of()))));
                    } else {
                        assertEquals(
                                "/v1/wallets/wallet-test/rpc", exchange.getRequestURI().getPath());
                        var body = Json.object(exchange.getRequestBody().readAllBytes());
                        requests.add(body);
                        headers.add(
                                exchange.getRequestHeaders()
                                        .getFirst("privy-authorization-signature"));
                        assertFalse(Json.canonical(body).contains(registration.privateKey()));
                        String method = (String) body.get("method");
                        if (method.equals("eth_sendTransaction")) {
                            var transaction =
                                    (Map<?, ?>) ((Map<?, ?>) body.get("params")).get("transaction");
                            assertEquals("0x66eee", transaction.get("chain_id"));
                            assertEquals("eip155:421614", body.get("caip2"));
                            assertEquals(
                                    "operation-test",
                                    exchange.getRequestHeaders().getFirst("privy-idempotency-key"));
                        }
                        response =
                                Json.canonical(
                                        Map.of(
                                                "method",
                                                method,
                                                "data",
                                                method.equals("eth_sendTransaction")
                                                        ? Map.of(
                                                                "hash",
                                                                txHash,
                                                                "caip2",
                                                                "eip155:421614")
                                                        : Map.of(
                                                                "signature",
                                                                signature,
                                                                "encoding",
                                                                "hex")));
                    }
                    byte[] bytes = response.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(failure.get() == 0 ? 200 : 503, bytes.length);
                    try (var out = exchange.getResponseBody()) {
                        out.write(bytes);
                    }
                });
        server.start();
        try {
            var client =
                    new PrivyClient(
                            new PrivyClientConfig(
                                    "app",
                                    "test-secret",
                                    URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
                                    Duration.ofSeconds(5)));
            var signer = new PrivyEvmSigner(client, "wallet-test", registration);
            assertEquals(address, signer.address());
            assertEquals(signature, signer.signMessage("DMRVN v4 source:test"));
            var typed =
                    Map.<String, Object>of(
                            "domain",
                            Map.of(
                                    "name",
                                    "Test",
                                    "version",
                                    "1",
                                    "chainId",
                                    421614,
                                    "verifyingContract",
                                    address),
                            "types",
                            Map.of("Test", List.of(Map.of("name", "amount", "type", "uint256"))),
                            "primaryType",
                            "Test",
                            "message",
                            Map.of("amount", "9007199254740993"));
            assertEquals(signature, signer.signTypedData(typed));
            assertEquals(
                    txHash,
                    signer.sendTransaction(
                            421614,
                            Map.of(
                                    "to",
                                    address,
                                    "value",
                                    "0x0",
                                    "data",
                                    "0x1234",
                                    "gas",
                                    "0x100000",
                                    "gasPrice",
                                    "0x1",
                                    "nonce",
                                    "0x0"),
                            "operation-test"));
            assertEquals(
                    List.of("personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"),
                    requests.stream().map(m -> m.get("method")).toList());
            assertTrue(headers.stream().allMatch(h -> h != null && !h.isBlank()));
            failure.set(1);
            assertThrows(DmrvnException.class, () -> signer.signMessage("test"));
            assertEquals(4, requests.size());
        } finally {
            server.stop(0);
        }
    }
}
