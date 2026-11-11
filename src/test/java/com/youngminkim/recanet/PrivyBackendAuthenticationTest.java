package com.youngminkim.recanet;

import com.sun.net.httpserver.HttpServer;
import io.privy.api.models.errors.APIException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Date;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class PrivyBackendAuthenticationTest {
    @Test
    void checksAppCredentialsThroughOneReadOnlyRequestWithLimitOne() throws Exception {
        var calls = new AtomicInteger();
        var query = new AtomicReference<String>();
        var method = new AtomicReference<String>();
        var server = server(200, "{\"data\":[],\"next_cursor\":null}", null, calls, query, method);
        try {
            var client = client(server);
            assertEquals(0, calls.get());
            client.verifyAppCredentials();
            assertEquals(1, calls.get());
            assertEquals("GET", method.get());
            assertTrue(query.get().matches("limit=1(?:\\.0)?"));
        } finally { server.stop(0); }
    }

    @ParameterizedTest
    @CsvSource({"401", "403", "429", "500", "503", "404"})
    void preservesPrivyStatusBodyAndHeadersWithoutRetrying(int status) throws Exception {
        var calls = new AtomicInteger();
        String body = "{\"error\":\"wallet_access_denied\",\"message\":\"Original Privy explanation\"}";
        var server = server(status, body, status == 429 ? "3" : null,
                calls, new AtomicReference<>(), new AtomicReference<>());
        try {
            var error = assertThrows(APIException.class, () -> client(server).verifyAppCredentials());
            assertEquals(status, error.code());
            assertEquals(body, error.bodyAsString().orElseThrow());
            assertEquals(1, calls.get());
            if (status == 429) assertEquals("3", error.rawResponse().headers().firstValue("Retry-After").orElseThrow());
        } finally { server.stop(0); }
    }

    @Test
    void supportsRetryAfterDateWithoutSleepingTheCaller() throws Exception {
        String retryAfter = ZonedDateTime.now(ZoneOffset.UTC).plusMinutes(1).format(DateTimeFormatter.RFC_1123_DATE_TIME);
        var server = server(429, "", retryAfter, new AtomicInteger(), new AtomicReference<>(), new AtomicReference<>());
        try {
            var error = assertThrows(APIException.class, () -> client(server).verifyAppCredentials());
            assertEquals(retryAfter, error.rawResponse().headers().firstValue("Retry-After").orElseThrow());
        } finally { server.stop(0); }
    }

    @Test
    void rejectsMalformedSuccessResponses() throws Exception {
        var server = server(200, "not-json-with-secret", null, new AtomicInteger(), new AtomicReference<>(), new AtomicReference<>());
        try {
            var error = assertThrows(APIException.class, () -> client(server).verifyAppCredentials());
            assertEquals(200, error.code());
            assertInstanceOf(com.fasterxml.jackson.core.JsonProcessingException.class, error.getCause());
        } finally { server.stop(0); }
    }

    @Test
    void authenticatesThroughFacadeWithoutContactingPrivy() throws Exception {
        var key = PrivyTokenVerifierTest.key("facade");
        var verification = PrivyTokenVerificationConfig.usingPublicKey(PrivyTokenVerifierTest.pem(key));
        var client = new PrivyClient(new PrivyClientConfig("app", "secret").withTokenVerification(verification));
        Instant now = Instant.now();
        var claims = new com.nimbusds.jwt.JWTClaimsSet.Builder(PrivyTokenVerifierTest.claims())
                .issueTime(Date.from(now.minusSeconds(60))).expirationTime(Date.from(now.plusSeconds(300))).build();
        String token = PrivyTokenVerifierTest.token(key, claims);
        assertEquals("did:privy:user-1", client.verifyAccessToken(token).userId());
        assertEquals("session-1", client.authenticateAuthorizationHeader("Bearer " + token).sessionId());
        assertThrows(IllegalStateException.class, () -> new PrivyClient(new PrivyClientConfig("app", "secret"))
                .verifyAccessToken(token));
        assertFalse(client.config().toString().contains("secret]"));
        assertTrue(client.config().toString().contains("[REDACTED]"));
    }

    @Test
    void rejectsCleartextRemoteCredentialTransport() {
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig(
                "app", "secret", URI.create("http://example.com"), Duration.ofSeconds(5)));
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig("app:ambiguous", "secret"));
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig(
                "app", "secret", URI.create("https://api.privy.io"), Duration.ofNanos(1)));
    }

    @Test
    void generatesP256BackendWalletKeysWithoutExposingPrivateKeyInToString() {
        var keys = BackendWalletKeyPair.generate();
        assertTrue(keys.publicKey().contains("BEGIN PUBLIC KEY"));
        assertTrue(keys.privateKey().contains("BEGIN PRIVATE KEY"));
        assertEquals(keys.publicKey(), keys.registration().publicKey());
        assertEquals(keys.privateKey(), keys.registration().privateKey());
        assertTrue(keys.toString().contains("[REDACTED]"));
        assertFalse(keys.toString().contains(keys.privateKey()));
    }

    @Test
    void registersBackendWalletWithPublicKeyOnlyAndVerifiesOwnership() throws Exception {
        var createBody = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/wallets", exchange -> {
            if ("POST".equals(exchange.getRequestMethod())) {
                createBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                byte[] body = "{\"id\":\"wallet-1\",\"address\":\"0xabc\",\"public_key\":\"pub-1\",\"created_at\":0,\"chain_type\":\"ethereum\",\"policy_ids\":[],\"owner_id\":null,\"additional_signers\":[],\"exported_at\":null,\"imported_at\":null}"
                        .getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                try (var output = exchange.getResponseBody()) { output.write(body); }
            } else {
                exchange.sendResponseHeaders(405, -1);
            }
        });
        server.createContext("/v1/wallets/wallet-1", exchange -> {
            byte[] body = "{\"id\":\"wallet-1\",\"address\":\"0xabc\",\"public_key\":\"pub-1\",\"created_at\":0,\"chain_type\":\"ethereum\",\"policy_ids\":[],\"owner_id\":null,\"additional_signers\":[],\"exported_at\":null,\"imported_at\":null}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            var client = client(server);
            var registration = new BackendWalletRegistration("pub-1", "private-secret");
            var wallet = client.registerBackendWallet(registration, new BackendWalletCreateRequest("ethereum"));
            assertEquals("wallet-1", wallet.id());
            assertEquals("0xabc", wallet.address());
            assertTrue(client.isBackendWallet("wallet-1", registration));
            assertFalse(createBody.get().contains("private-secret"));
            assertTrue(createBody.get().contains("pub-1"));
            assertTrue(registration.toString().contains("[REDACTED]"));
            assertFalse(registration.toString().contains("private-secret"));
        } finally { server.stop(0); }
    }

    private static PrivyClient client(HttpServer server) {
        return new PrivyClient(new PrivyClientConfig("app", "secret",
                URI.create("http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(5)));
    }

    private static HttpServer server(int status, String response, String retryAfter, AtomicInteger calls,
                                      AtomicReference<String> query, AtomicReference<String> method) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/users", exchange -> {
            calls.incrementAndGet();
            query.set(exchange.getRequestURI().getRawQuery());
            method.set(exchange.getRequestMethod());
            assertEquals("app", exchange.getRequestHeaders().getFirst("privy-app-id"));
            assertEquals("Basic YXBwOnNlY3JldA==", exchange.getRequestHeaders().getFirst("Authorization"));
            if (retryAfter != null) exchange.getResponseHeaders().set("Retry-After", retryAfter);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            byte[] body = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length == 0 ? -1 : body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        return server;
    }
}
