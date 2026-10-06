package com.youngminkim.recanet;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.gen.ECKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

class PrivyTokenVerifierTest {
    private static final Instant NOW = Instant.parse("2026-10-02T00:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final ECKey KEY = key("key-1");
    private static final ECKey ROTATED_KEY = key("key-2");

    @Test
    void verifiesOfflineAndReturnsOnlyVerifiedClaims() throws Exception {
        var verifier = offline();
        String token = token(KEY, claims());
        AuthenticatedUser user = verifier.verifyAccessToken(token);
        assertEquals("app", user.appId());
        assertEquals("did:privy:user-1", user.userId());
        assertEquals("session-1", user.sessionId());
        assertEquals(NOW.minusSeconds(60), user.issuedAt());
        assertEquals(NOW.plusSeconds(3600), user.expiresAt());
        assertFalse(user.toString().contains(token));
        assertEquals(user, verifier.authenticateAuthorizationHeader("bearer " + token));
    }

    @Test
    void rejectsForgedSignatureAndModifiedPayload() throws Exception {
        String forged = token(ROTATED_KEY, claims());
        assertFailure(offline(), forged, PrivyAuthenticationException.Code.INVALID_TOKEN);
        String legitimate = token(KEY, claims());
        String[] parts = legitimate.split("\\.");
        String changedClaims = claims().toString().replace("user-1", "attacker");
        String altered = parts[0] + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(changedClaims.getBytes(StandardCharsets.UTF_8)) + "." + parts[2];
        assertFailure(offline(), altered, PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    @Test
    void rejectsUnsignedAndSymmetricTokens() throws Exception {
        assertFailure(offline(), new PlainJWT(claims()).serialize(), PrivyAuthenticationException.Code.INVALID_TOKEN);
        SignedJWT hmac = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.HS256).type(JOSEObjectType.JWT).build(), claims());
        hmac.sign(new MACSigner(new byte[32]));
        assertFailure(offline(), hmac.serialize(), PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    @Test
    void rejectsMissingOrUnexpectedTypeAndCriticalHeaders() throws Exception {
        for (JOSEObjectType type : new JOSEObjectType[]{null, new JOSEObjectType("at+jwt"), new JOSEObjectType("id+jwt")}) {
            var header = new JWSHeader.Builder(JWSAlgorithm.ES256).type(type).build();
            assertFailure(offline(), sign(KEY, header, claims()), PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
        var critical = new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT)
                .criticalParams(Set.of("unknown")).customParam("unknown", "value").build();
        assertFailure(offline(), sign(KEY, critical, claims()), PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    @ParameterizedTest
    @ValueSource(strings = {"iss", "aud", "sub", "sid", "iat", "exp"})
    void requiresAllPrivyAccessTokenClaims(String claim) throws Exception {
        var modified = new JWTClaimsSet.Builder(claims()).claim(claim, null).build();
        assertFailure(offline(), token(KEY, modified), PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    @Test
    void rejectsWrongIssuerAudienceSubjectAndSessionAndIdentityTokens() throws Exception {
        List<JWTClaimsSet> invalid = List.of(
                new JWTClaimsSet.Builder(claims()).issuer("attacker.example").build(),
                new JWTClaimsSet.Builder(claims()).audience("other-app").build(),
                new JWTClaimsSet.Builder(claims()).audience(List.of("app", "other-app")).build(),
                new JWTClaimsSet.Builder(claims()).subject("did:privy:").build(),
                new JWTClaimsSet.Builder(claims()).subject("firebase-user").build(),
                new JWTClaimsSet.Builder(claims()).claim("sid", " ").build(),
                new JWTClaimsSet.Builder(claims()).claim("sid", 123).build(),
                new JWTClaimsSet.Builder(claims()).claim("linked_accounts", "[]").build());
        for (var value : invalid) assertFailure(offline(), token(KEY, value), PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    @Test
    void checksExpirationBoundaryFutureIssuanceAndNotBefore() throws Exception {
        for (Instant expiration : List.of(NOW, NOW.minusSeconds(1))) {
            var expired = new JWTClaimsSet.Builder(claims()).expirationTime(Date.from(expiration)).build();
            assertFailure(offline(), token(KEY, expired), PrivyAuthenticationException.Code.EXPIRED_TOKEN);
        }
        for (var invalid : List.of(
                new JWTClaimsSet.Builder(claims()).issueTime(Date.from(NOW.plusSeconds(1))).build(),
                new JWTClaimsSet.Builder(claims()).notBeforeTime(Date.from(NOW.plusSeconds(1))).build(),
                new JWTClaimsSet.Builder(claims()).expirationTime(Date.from(NOW.minusSeconds(120))).build())) {
            assertFailure(offline(), token(KEY, invalid), PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
    }

    @Test
    void neverCachesAValidTokenPastItsExpiration() throws Exception {
        var time = new AtomicReference<>(NOW);
        Clock movingClock = new Clock() {
            @Override public ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return time.get(); }
        };
        var verifier = new PrivyTokenVerifier("app", publicKeyConfig(), movingClock);
        String token = token(KEY, new JWTClaimsSet.Builder(claims()).expirationTime(Date.from(NOW.plusSeconds(1))).build());
        assertEquals("did:privy:user-1", verifier.verifyAccessToken(token).userId());
        time.set(NOW.plusSeconds(1));
        assertFailure(verifier, token, PrivyAuthenticationException.Code.EXPIRED_TOKEN);
    }

    @Test
    void supportsExplicitBoundedClockSkew() throws Exception {
        var config = publicKeyConfig().withClockSkew(Duration.ofSeconds(10));
        var verifier = new PrivyTokenVerifier("app", config, CLOCK);
        var claims = new JWTClaimsSet.Builder(claims()).expirationTime(Date.from(NOW.minusSeconds(9))).build();
        assertEquals("session-1", verifier.verifyAccessToken(token(KEY, claims)).sessionId());
        assertThrows(IllegalArgumentException.class, () -> config.withClockSkew(Duration.ofMinutes(2)));
        assertThrows(IllegalArgumentException.class, () -> config.withClockSkew(Duration.ofMillis(-1)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Basic secret", "Bearer", "Bearer ", "Bearer a b", "Bearer a,Bearer b", "Bearer a\r\nInjected: secret"})
    void rejectsMalformedAuthorizationHeaders(String header) {
        assertThrows(PrivyAuthenticationException.class, () -> offline().authenticateAuthorizationHeader(header));
    }

    @Test
    void rejectsMalformedAndOversizedTokensWithoutEchoingThem() {
        assertFailure(offline(), "ey.secret.invalid", PrivyAuthenticationException.Code.INVALID_TOKEN);
        assertFailure(offline(), "x".repeat(16 * 1024 + 1), PrivyAuthenticationException.Code.INVALID_TOKEN);
        assertFailure(offline(), null, PrivyAuthenticationException.Code.MISSING_TOKEN);
        assertFailure(offline(), " ", PrivyAuthenticationException.Code.MISSING_TOKEN);
    }

    @Test
    void validatesPublicKeyAndNetworkConfiguration() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> new PrivyTokenVerifier("app",
                PrivyTokenVerificationConfig.usingPublicKey("not-a-key")));
        var wrongCurve = new ECKeyGenerator(Curve.P_384).generate();
        assertThrows(IllegalArgumentException.class, () -> new PrivyTokenVerifier("app",
                PrivyTokenVerificationConfig.usingPublicKey(pem(wrongCurve))));
        for (URI uri : List.of(URI.create("http://untrusted.example/jwks"), URI.create("file:///etc/secret"),
                URI.create("https://user:secret@example.com/jwks"))) {
            assertThrows(IllegalArgumentException.class, () -> PrivyTokenVerificationConfig.usingJwks(uri));
        }
        var config = PrivyTokenVerificationConfig.usingJwks(URI.create("https://example.com/jwks"));
        assertThrows(IllegalArgumentException.class, () -> config.withJwksPolicy(
                Duration.ZERO, Duration.ofMinutes(5), Duration.ofSeconds(30)));
        assertThrows(IllegalArgumentException.class, () -> config.withJwksPolicy(
                Duration.ofSeconds(5), Duration.ofSeconds(30), Duration.ofSeconds(30)));
        assertThrows(IllegalArgumentException.class, () -> config.withJwksPolicy(
                Duration.ofSeconds(5), Duration.ofMillis(30).plusNanos(1), Duration.ofMillis(30)));
    }

    @Test
    void sharesOneColdJwksFetchAcrossConcurrentRequestsAndHandlesRotation() throws Exception {
        AtomicReference<String> document = new AtomicReference<>(new JWKSet(KEY.toPublicJWK()).toString());
        AtomicInteger fetches = new AtomicInteger();
        AtomicReference<String> leakedAuthorization = new AtomicReference<>();
        var server = jwksServer(document, fetches, leakedAuthorization);
        var executor = Executors.newFixedThreadPool(8);
        try {
            var verifier = remote(server);
            assertEquals(0, fetches.get()); // construction is lazy
            String token = token(KEY, claims());
            CountDownLatch start = new CountDownLatch(1);
            var tasks = new ArrayList<java.util.concurrent.Future<AuthenticatedUser>>();
            for (int i = 0; i < 32; i++) {
                tasks.add(executor.submit(() -> { start.await(); return verifier.verifyAccessToken(token); }));
            }
            start.countDown();
            for (var task : tasks) assertEquals("session-1", task.get(5, TimeUnit.SECONDS).sessionId());
            assertEquals(1, fetches.get());
            assertNull(leakedAuthorization.get());

            document.set(new JWKSet(ROTATED_KEY.toPublicJWK()).toString());
            assertEquals("did:privy:user-1", verifier.verifyAccessToken(token(ROTATED_KEY, claims())).userId());
            assertEquals(2, fetches.get());
            verifier.verifyAccessToken(token(ROTATED_KEY, claims()));
            assertEquals(2, fetches.get());
        } finally {
            executor.shutdownNow();
            server.stop(0);
        }
    }

    @Test
    void rejectsInvalidClaimsWithoutNetworkAndIgnoresTokenSuppliedJwksUrl() throws Exception {
        var document = new AtomicReference<>(new JWKSet(KEY.toPublicJWK()).toString());
        var fetches = new AtomicInteger();
        var server = jwksServer(document, fetches, new AtomicReference<>());
        try {
            var verifier = remote(server);
            assertFailure(verifier, token(KEY, new JWTClaimsSet.Builder(claims()).issuer("attacker").build()),
                    PrivyAuthenticationException.Code.INVALID_TOKEN);
            assertEquals(0, fetches.get());
            var header = new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT)
                    .keyID(KEY.getKeyID()).jwkURL(URI.create("http://127.0.0.1:1/attacker-jwks")).build();
            assertEquals("session-1", verifier.verifyAccessToken(sign(KEY, header, claims())).sessionId());
            assertEquals(1, fetches.get());
        } finally { server.stop(0); }
    }

    @Test
    void boundsUnknownKeyRefreshesAndFailsClosedOnBadJwks() throws Exception {
        var document = new AtomicReference<>(new JWKSet(KEY.toPublicJWK()).toString());
        var fetches = new AtomicInteger();
        var server = jwksServer(document, fetches, new AtomicReference<>());
        try {
            var verifier = remote(server);
            verifier.verifyAccessToken(token(KEY, claims()));
            String unknown = token(ROTATED_KEY, claims());
            for (int i = 0; i < 10; i++) {
                assertThrows(PrivyAuthenticationException.class, () -> verifier.verifyAccessToken(unknown));
            }
            assertEquals(2, fetches.get());
            assertEquals("session-1", verifier.verifyAccessToken(token(KEY, claims())).sessionId());
            document.set("{not-valid-jwks}");
            assertFailure(remote(server), token(KEY, claims()), PrivyAuthenticationException.Code.KEY_SOURCE_UNAVAILABLE);
        } finally { server.stop(0); }
    }

    @Test
    void doesNotAcceptAnUnknownKeyDuringJwksOutage() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/jwks", exchange -> { exchange.sendResponseHeaders(503, -1); exchange.close(); });
        server.start();
        try {
            assertFailure(remote(server), token(KEY, claims()), PrivyAuthenticationException.Code.KEY_SOURCE_UNAVAILABLE);
        } finally { server.stop(0); }
    }

    @Test
    void failsClosedWhenTheKeyCacheExpiresAndTheSourceFails() throws Exception {
        var document = new AtomicReference<>(new JWKSet(KEY.toPublicJWK()).toString());
        var server = jwksServer(document, new AtomicInteger(), new AtomicReference<>());
        try {
            var config = PrivyTokenVerificationConfig.usingJwks(
                            URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/jwks"))
                    .withJwksPolicy(Duration.ofSeconds(5), Duration.ofSeconds(1), Duration.ofMillis(100));
            var verifier = new PrivyTokenVerifier("app", config, CLOCK);
            String token = token(KEY, claims());
            verifier.verifyAccessToken(token);
            document.set("{invalid-jwks}");
            Thread.sleep(1100);
            assertFailure(verifier, token, PrivyAuthenticationException.Code.KEY_SOURCE_UNAVAILABLE);
        } finally { server.stop(0); }
    }

    @Test
    void rejectsInvalidNumericDateTypesFractionsAndOverflow() throws Exception {
        for (Object expiration : List.of("not-a-number", 1.5, Long.MAX_VALUE)) {
            var raw = new java.util.HashMap<>(claims().toJSONObject());
            raw.put("exp", expiration);
            var jws = new com.nimbusds.jose.JWSObject(
                    new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT).build(), new Payload(raw));
            jws.sign(new ECDSASigner(KEY));
            assertFailure(offline(), jws.serialize(), PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
    }

    @Test
    void malformedSignatureIsAnInvalidTokenNotAKeySourceOutage() throws Exception {
        String valid = token(KEY, claims());
        String malformed = valid.substring(0, valid.lastIndexOf('.') + 1) + "AA";
        assertFailure(offline(), malformed, PrivyAuthenticationException.Code.INVALID_TOKEN);
    }

    static ECKey key(String id) {
        try { return new ECKeyGenerator(Curve.P_256).keyID(id).generate(); }
        catch (Exception e) { throw new ExceptionInInitializerError(e); }
    }

    static String pem(ECKey key) throws Exception {
        return "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, new byte[]{'\n'})
                .encodeToString(key.toECPublicKey().getEncoded()) + "\n-----END PUBLIC KEY-----";
    }

    static JWTClaimsSet claims() {
        return new JWTClaimsSet.Builder().issuer("privy.io").audience("app")
                .subject("did:privy:user-1").claim("sid", "session-1")
                .issueTime(Date.from(NOW.minusSeconds(60))).expirationTime(Date.from(NOW.plusSeconds(3600))).build();
    }

    static String token(ECKey key, JWTClaimsSet claims) throws Exception {
        return sign(key, new JWSHeader.Builder(JWSAlgorithm.ES256).type(JOSEObjectType.JWT).keyID(key.getKeyID()).build(), claims);
    }

    private static String sign(ECKey key, JWSHeader header, JWTClaimsSet claims) throws Exception {
        var jwt = new SignedJWT(header, claims);
        jwt.sign(new ECDSASigner(key));
        return jwt.serialize();
    }

    private static PrivyTokenVerificationConfig publicKeyConfig() {
        try { return PrivyTokenVerificationConfig.usingPublicKey(pem(KEY)); }
        catch (Exception e) { throw new AssertionError(e); }
    }

    private static PrivyTokenVerifier offline() { return new PrivyTokenVerifier("app", publicKeyConfig(), CLOCK); }

    private static PrivyTokenVerifier remote(HttpServer server) {
        return new PrivyTokenVerifier("app", PrivyTokenVerificationConfig.usingJwks(
                URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/jwks")), CLOCK);
    }

    private static HttpServer jwksServer(AtomicReference<String> document, AtomicInteger fetches,
                                         AtomicReference<String> authorization) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/jwks", exchange -> {
            fetches.incrementAndGet();
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = document.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        return server;
    }

    private static void assertFailure(PrivyTokenVerifier verifier, String token, PrivyAuthenticationException.Code code) {
        var failure = assertThrows(PrivyAuthenticationException.class, () -> verifier.verifyAccessToken(token));
        assertEquals(code, failure.code());
        assertNull(failure.getCause());
        if (token != null && !token.isBlank()) assertFalse(failure.toString().contains(token));
    }
}
