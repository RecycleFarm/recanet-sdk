package com.youngminkim.recanet;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.KeySourceException;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.BadJOSEException;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.proc.SingleKeyJWSKeySelector;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

import java.net.MalformedURLException;
import java.math.BigDecimal;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.ECPublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.text.ParseException;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Objects;
import java.util.regex.Pattern;

/** Reusable, thread-safe verifier for Privy access tokens. No app secret is required. */
public final class PrivyTokenVerifier {
    private static final int MAX_TOKEN_LENGTH = 16 * 1024;
    private static final Pattern BEARER = Pattern.compile("Bearer +([^\\s,]+)", Pattern.CASE_INSENSITIVE);
    private final String appId;
    private final PrivyTokenVerificationConfig config;
    private final Clock clock;
    private final DefaultJWTProcessor<SecurityContext> processor;

    /**
     * Creates a verifier. Public keys are parsed once; remote JWKS retrieval is lazy.
     * @param appId expected Privy app ID
     * @param config trusted public-key source and verification policy
     */
    public PrivyTokenVerifier(String appId, PrivyTokenVerificationConfig config) {
        this(appId, config, Clock.systemUTC());
    }

    PrivyTokenVerifier(String appId, PrivyTokenVerificationConfig config, Clock clock) {
        if (appId == null || appId.isBlank()) throw new IllegalArgumentException("appId must not be blank");
        this.appId = appId;
        this.config = Objects.requireNonNull(config, "config");
        this.clock = Objects.requireNonNull(clock, "clock");
        processor = new DefaultJWTProcessor<>();
        processor.setJWSTypeVerifier(new DefaultJOSEObjectTypeVerifier<>(JOSEObjectType.JWT));
        processor.setJWTClaimsSetVerifier((claims, context) -> validateClaims(claims));
        if (config.verificationKeyPem() != null) {
            processor.setJWSKeySelector(new SingleKeyJWSKeySelector<>(JWSAlgorithm.ES256,
                    parsePublicKey(config.verificationKeyPem())));
        } else {
            try {
                int timeout = Math.toIntExact(config.jwksTimeout().toMillis());
                var keys = JWKSourceBuilder.<SecurityContext>create(config.jwksUri().toURL(),
                                new DefaultResourceRetriever(timeout, timeout, 128 * 1024))
                        .cache(config.cacheTtl().toMillis(), timeout)
                        .rateLimited(config.refreshCooldown().toMillis())
                        .refreshAheadCache(false)
                        .retrying(false)
                        .outageTolerant(false)
                        .build();
                processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.ES256, keys));
            } catch (MalformedURLException e) {
                throw new IllegalArgumentException("jwksUri is invalid");
            }
        }
    }

    /**
     * Verifies signature, issuer, app ID, expiry, issuance time, subject, and session.
     * @param accessToken raw compact access JWT (without the Bearer prefix)
     * @return verified claims; does not return or retain the raw token
     * @throws PrivyAuthenticationException if verification fails
     */
    public AuthenticatedUser verifyAccessToken(String accessToken) {
        if (accessToken == null) throw failure(PrivyAuthenticationException.Code.MISSING_TOKEN);
        if (accessToken.length() > MAX_TOKEN_LENGTH) throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        if (accessToken.isBlank()) throw failure(PrivyAuthenticationException.Code.MISSING_TOKEN);
        try {
            SignedJWT jwt = SignedJWT.parse(accessToken);
            var header = jwt.getHeader();
            if (!JWSAlgorithm.ES256.equals(header.getAlgorithm()) || !JOSEObjectType.JWT.equals(header.getType())
                    || (header.getCriticalParams() != null && !header.getCriticalParams().isEmpty())
                    || (header.getKeyID() != null && header.getKeyID().length() > 256)) {
                throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
            }
            validateNumericDates(jwt);
            // Reject impossible inputs before key retrieval. These claims are still untrusted.
            validateClaims(jwt.getJWTClaimsSet());
            // Nimbus verifies the signature and validates the claims again before returning.
            JWTClaimsSet claims = processor.process(jwt, null);
            return new AuthenticatedUser(appId, claims.getSubject(), claims.getStringClaim("sid"),
                    claims.getIssueTime().toInstant(), claims.getExpirationTime().toInstant());
        } catch (KeySourceException e) {
            throw failure(PrivyAuthenticationException.Code.KEY_SOURCE_UNAVAILABLE);
        } catch (ParseException | BadJOSEException | JOSEException e) {
            throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
    }

    /**
     * Parses exactly one Bearer credential and verifies it.
     * @param authorizationHeader value of the HTTP Authorization header
     * @return verified access-token claims
     * @throws PrivyAuthenticationException if the header or token is invalid
     */
    public AuthenticatedUser authenticateAuthorizationHeader(String authorizationHeader) {
        if (authorizationHeader == null) {
            throw failure(PrivyAuthenticationException.Code.MISSING_TOKEN);
        }
        if (authorizationHeader.length() > MAX_TOKEN_LENGTH + 32) {
            throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
        if (authorizationHeader.isBlank()) throw failure(PrivyAuthenticationException.Code.MISSING_TOKEN);
        var matcher = BEARER.matcher(authorizationHeader);
        if (!matcher.matches()) throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        return verifyAccessToken(matcher.group(1));
    }

    private static void validateNumericDates(SignedJWT jwt) {
        var rawClaims = jwt.getPayload().toJSONObject();
        if (rawClaims == null) throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        for (String name : java.util.List.of("iat", "exp", "nbf")) {
            Object value = rawClaims.get(name);
            if (value == null && "nbf".equals(name)) continue;
            if (!(value instanceof Number number)) throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
            try {
                long seconds = new BigDecimal(number.toString()).longValueExact();
                if (seconds < 0) throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
                // Nimbus converts NumericDate seconds to milliseconds. Reject overflow before conversion.
                Math.multiplyExact(seconds, 1000L);
            } catch (NumberFormatException | ArithmeticException e) {
                throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
            }
        }
    }

    private void validateClaims(JWTClaimsSet claims) {
        try {
            if (!"privy.io".equals(claims.getIssuer())
                    || !claims.getAudience().equals(java.util.List.of(appId))
                    || claims.getSubject() == null || !claims.getSubject().startsWith("did:privy:")
                    || claims.getSubject().length() <= "did:privy:".length()
                    || claims.getStringClaim("sid") == null || claims.getStringClaim("sid").isBlank()
                    || claims.getClaim("linked_accounts") != null) {
                throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
            }
            Date issued = claims.getIssueTime();
            Date expires = claims.getExpirationTime();
            Date notBefore = claims.getNotBeforeTime();
            Instant now = clock.instant();
            if (issued == null || expires == null || issued.getTime() < 0 || !expires.after(issued)
                    || issued.toInstant().isAfter(now.plus(config.clockSkew()))
                    || (notBefore != null && notBefore.toInstant().isAfter(now.plus(config.clockSkew())))) {
                throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
            }
            if (!expires.toInstant().isAfter(now.minus(config.clockSkew()))) {
                throw failure(PrivyAuthenticationException.Code.EXPIRED_TOKEN);
            }
        } catch (ParseException e) {
            throw failure(PrivyAuthenticationException.Code.INVALID_TOKEN);
        }
    }

    private static ECPublicKey parsePublicKey(String pem) {
        try {
            String trimmed = pem.strip();
            String begin = "-----BEGIN PUBLIC KEY-----";
            String end = "-----END PUBLIC KEY-----";
            if (!trimmed.startsWith(begin) || !trimmed.endsWith(end)) {
                throw new IllegalArgumentException("verificationKeyPem must be an SPKI P-256 public key");
            }
            byte[] der = Base64.getDecoder().decode(trimmed.substring(begin.length(), trimmed.length() - end.length())
                    .replaceAll("\\s", ""));
            var key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
            if (!(key instanceof ECPublicKey ec) || !Curve.P_256.equals(Curve.forECParameterSpec(ec.getParams()))) {
                throw new IllegalArgumentException("verificationKeyPem must be an SPKI P-256 public key");
            }
            return ec;
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalArgumentException("verificationKeyPem must be an SPKI P-256 public key");
        }
    }

    private static PrivyAuthenticationException failure(PrivyAuthenticationException.Code code) {
        return new PrivyAuthenticationException(code);
    }
}
