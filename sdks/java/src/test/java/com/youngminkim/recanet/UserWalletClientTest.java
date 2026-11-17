package com.youngminkim.recanet;

import com.sun.net.httpserver.HttpServer;
import com.youngminkim.recanet.dmrvn.Json;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class UserWalletClientTest {
    @Test
    void partnerAdapterCreatesWalletsAndSeparatesTheSameMemberAcrossPartners() throws Exception {
        try (var fixture = new Fixture()) {
            var base = fixture.client("service", fixture.key);
            var first = base.forPartner(101, (p, u) -> p == 101 && u.equals("member"));
            var second = base.forPartner(102, (p, u) -> p == 102 && u.equals("member"));
            var signer = first.getOrCreateSigner(101, "member");
            assertEquals(signer.address(), first.getOrCreateSigner(101, "member").address());
            assertNotEquals(signer.address(), second.getOrCreateSigner(102, "member").address());
            assertEquals(Fixture.SIGNATURE, signer.signMessage("authorized"));
            assertEquals(2, fixture.creates);
            int before = fixture.requests;
            assertThrows(com.youngminkim.recanet.dmrvn.DmrvnException.class,
                    () -> first.getOrCreateSigner(102, "member"));
            assertThrows(com.youngminkim.recanet.dmrvn.DmrvnException.class,
                    () -> first.getOrCreateSigner(101, "other"));
            assertEquals(before, fixture.requests);
        }
    }

    @Test
    void partnerConsentIsCheckedAgainAtSigningTime() throws Exception {
        try (var fixture = new Fixture()) {
            var allowed = new java.util.concurrent.atomic.AtomicBoolean(true);
            var provider = fixture.client("service", fixture.key)
                    .forPartner(101, (p, u) -> allowed.get());
            var signer = provider.getOrCreateSigner(101, "member");
            allowed.set(false);
            assertThrows(com.youngminkim.recanet.dmrvn.DmrvnException.class,
                    () -> signer.signMessage("revoked"));
            assertThrows(com.youngminkim.recanet.dmrvn.DmrvnException.class,
                    () -> signer.signTypedData(Map.of()));
            assertThrows(com.youngminkim.recanet.dmrvn.DmrvnException.class,
                    () -> signer.sendTransaction(421614, Map.of(), "id"));
            assertTrue(fixture.methods.isEmpty());
        }
    }

    @Test
    void legacyMemberIdentifiersCannotSelectPartnerWallets() throws Exception {
        try (var fixture = new Fixture()) {
            var base = fixture.client("service", fixture.key);
            var legacy = base.getOrCreateWallet("101\0member");
            var partner = base.forPartner(101, (p, u) -> true).getOrCreateSigner(101, "member");
            assertNotEquals(legacy.address(), partner.address());
            assertEquals(2, fixture.creates);
        }
    }

    @Test
    void resolvesExistingAuthorizedMemberSigner() throws Exception {
        try (var fixture = new Fixture()) {
            var wallets = fixture.client("service", fixture.key);
            var member = wallets.getOrCreateWallet("member-1");
            var signer = wallets.signerFor("member-1");
            assertEquals(member.address().toLowerCase(Locale.ROOT), signer.address());
            assertEquals(Fixture.SIGNATURE, signer.signMessage("hello"));
            assertEquals(List.of(member.id()), fixture.signedWalletIds);
            assertThrows(IllegalStateException.class, () -> wallets.signerFor("unknown-member"));
            var otherKey = fixture.client("service", BackendWalletKeyPair.generate().registration());
            assertThrows(IllegalStateException.class, () -> otherKey.signerFor("member-1"));
            assertEquals(1, fixture.creates);
            assertEquals(1, fixture.methods.size());
        }
    }

    @Test
    void provisionsDistinctMemberWalletsAndReusesThemWithoutUserLogin() throws Exception {
        try (var fixture = new Fixture()) {
            var wallets = fixture.client("service-a", fixture.key);
            var first = wallets.getOrCreateWallet("member-1");
            assertEquals(first, wallets.getOrCreateWallet("member-1"));
            var second = wallets.getOrCreateWallet("member-2");
            var otherTenant = fixture.client("service-b", fixture.key).getOrCreateWallet("member-1");
            assertNotEquals(first.id(), second.id());
            assertNotEquals(first.id(), otherTenant.id());
            assertEquals(3, fixture.creates);
            for (var request : fixture.createRequests) {
                assertEquals("ethereum", request.get("chain_type"));
                assertEquals(Map.of("public_key", fixture.key.publicKey()), request.get("owner"));
                String externalId = (String) request.get("external_id");
                assertTrue(externalId.matches("[a-zA-Z0-9_-]{1,64}"));
                assertFalse(externalId.contains("member"));
                assertFalse(Json.canonical(request).contains(fixture.key.privateKey()));
            }
        }
    }

    @Test
    void signsMessagesTypedDataAndTransactionsForResolvedMemberOnly() throws Exception {
        try (var fixture = new Fixture()) {
            var wallets = fixture.client("service", fixture.key);
            var first = wallets.getOrCreateWallet("member-1");
            var second = wallets.getOrCreateWallet("member-2");
            assertEquals(Fixture.SIGNATURE, wallets.signMessage("member-1", "hello"));
            assertEquals(Fixture.SIGNATURE, wallets.signTypedData("member-2", Map.of(
                    "domain", Map.of("name", "Test", "chainId", 421614),
                    "types", Map.of("Test", List.of(Map.of("name", "amount", "type", "uint256"))),
                    "primaryType", "Test", "message", Map.of("amount", "42"))));
            assertEquals(Fixture.HASH, wallets.sendTransaction("member-1", 421614,
                    Map.of("to", second.address(), "value", "0x0", "data", "0x",
                            "gas", "0x5208", "gasPrice", "0x1", "nonce", "0x0"), "operation-1"));
            assertEquals(List.of(first.id(), second.id(), first.id()), fixture.signedWalletIds);
            assertEquals(List.of("personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"), fixture.methods);
            assertThrows(IllegalStateException.class, () -> wallets.signMessage("unknown-member", "hello"));
            var wrongKey = fixture.client("service", BackendWalletKeyPair.generate().registration());
            assertThrows(IllegalStateException.class, () -> wrongKey.signMessage("member-1", "hello"));
            assertEquals(3, fixture.methods.size());
        }
    }

    @Test
    void recoversConcurrentCreationConflictWithoutRetryingCreation() throws Exception {
        try (var fixture = new Fixture()) {
            fixture.createStatus = 409; // Simulate another worker creating the wallet first.
            var wallet = fixture.client("service", fixture.key).getOrCreateWallet("member-1");
            assertEquals("wallet-1", wallet.id());
            assertEquals(1, fixture.creates);
        }
    }

    @Test
    void rejectsMismatchedMemberMetadataAndDoesNotRetryFailedOperations() throws Exception {
        try (var fixture = new Fixture()) {
            var wallets = fixture.client("service", fixture.key);
            wallets.getOrCreateWallet("member-1");
            fixture.wrongExternalId = true;
            assertEquals(PrivyApiException.Code.INVALID_RESPONSE,
                    assertThrows(PrivyApiException.class,
                            () -> wallets.signMessage("member-1", "hello")).code());
            assertTrue(fixture.methods.isEmpty());
            fixture.wrongExternalId = false;
            fixture.rpcStatus = 503;
            assertThrows(RuntimeException.class, () -> wallets.signMessage("member-1", "hello"));
            assertEquals(1, fixture.methods.size());
            fixture.createStatus = 503;
            var error = assertThrows(PrivyApiException.class, () -> wallets.getOrCreateWallet("member-2"));
            assertEquals(503, error.statusCode());
            assertFalse(error.toString().contains("sensitive"));
            assertNull(error.getCause());
            assertEquals(2, fixture.creates);
        }
    }

    @Test
    void rejectsInvalidInputsBeforeNetworkRequests() throws Exception {
        try (var fixture = new Fixture()) {
            assertThrows(IllegalArgumentException.class, () -> fixture.client("bad namespace", fixture.key));
            var wallets = fixture.client("service", fixture.key);
            assertThrows(IllegalArgumentException.class, () -> wallets.getOrCreateWallet(" "));
            assertThrows(IllegalArgumentException.class, () -> wallets.findWallet(null));
            assertThrows(IllegalArgumentException.class,
                    () -> wallets.sendTransaction("member", 1, Map.of(), ""));
            assertEquals(0, fixture.requests);
        }
    }

    private static final class Fixture implements AutoCloseable {
        static final String SIGNATURE = "0x" + "11".repeat(65);
        static final String HASH = "0x" + "22".repeat(32);
        final BackendWalletRegistration key = BackendWalletKeyPair.generate().registration();
        final HttpServer server;
        final List<Map<String, Object>> createRequests = new ArrayList<>();
        final List<String> signedWalletIds = new ArrayList<>();
        final List<String> methods = new ArrayList<>();
        final Map<String, Map<String, Object>> stored = new LinkedHashMap<>();
        int creates, requests, createStatus = 200, rpcStatus = 200;
        boolean wrongExternalId;

        Fixture() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/v1/wallets", exchange -> {
                requests++;
                int status = 200;
                Object response;
                String path = exchange.getRequestURI().getPath();
                if (exchange.getRequestMethod().equals("GET")) {
                    var query = query(exchange.getRequestURI().getRawQuery());
                    assertTrue(query.containsKey("authorization_key"));
                    var selected = new ArrayList<Map<String, Object>>();
                    if (key.publicKey().equals(query.get("authorization_key"))) {
                        for (var entry : stored.entrySet()) {
                            if (!query.containsKey("external_id") || entry.getKey().equals(query.get("external_id"))) {
                                var wallet = new LinkedHashMap<>(entry.getValue());
                                if (wrongExternalId) wallet.put("external_id", "other-member");
                                selected.add(wallet);
                            }
                        }
                    }
                    response = Map.of("data", selected);
                } else if (path.equals("/v1/wallets")) {
                    creates++;
                    var body = Json.object(exchange.getRequestBody().readAllBytes());
                    createRequests.add(body);
                    String externalId = (String) body.get("external_id");
                    var wallet = new LinkedHashMap<String, Object>();
                    wallet.put("id", "wallet-" + creates);
                    wallet.put("address", "0x" + String.format("%040x", creates));
                    wallet.put("external_id", externalId);
                    wallet.put("chain_type", "ethereum");
                    wallet.put("public_key", "blockchain-public-key");
                    wallet.put("created_at", 0);
                    wallet.put("policy_ids", List.of());
                    wallet.put("additional_signers", List.of());
                    status = createStatus;
                    if (status == 200 || status == 409) stored.putIfAbsent(externalId, wallet);
                    response = status == 200 ? wallet : Map.of("error", "sensitive upstream body");
                } else {
                    assertTrue(path.endsWith("/rpc"));
                    assertNotNull(exchange.getRequestHeaders().getFirst("privy-authorization-signature"));
                    assertNotNull(exchange.getRequestHeaders().getFirst("Authorization"));
                    var body = Json.object(exchange.getRequestBody().readAllBytes());
                    assertFalse(Json.canonical(body).contains(key.privateKey()));
                    String method = (String) body.get("method");
                    signedWalletIds.add(path.split("/")[3]);
                    methods.add(method);
                    if (method.equals("eth_sendTransaction")) {
                        assertEquals("operation-1", exchange.getRequestHeaders().getFirst("privy-idempotency-key"));
                    }
                    status = rpcStatus;
                    response = Map.of("method", method, "data", method.equals("eth_sendTransaction")
                            ? Map.of("hash", HASH, "caip2", "eip155:421614")
                            : Map.of("signature", SIGNATURE, "encoding", "hex"));
                }
                byte[] bytes = Json.canonical(response).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
        }

        UserWalletClient client(String namespace, BackendWalletRegistration registration) {
            return new UserWalletClient(new PrivyClient(new PrivyClientConfig("app", "test-secret",
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(5))),
                    registration, namespace);
        }

        static Map<String, String> query(String value) {
            var result = new HashMap<String, String>();
            for (String part : value.split("&")) {
                var pair = part.split("=", 2);
                result.put(URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
                        URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
            }
            return result;
        }

        @Override public void close() { server.stop(0); }
    }
}
