package com.youngminkim.recanet;

import java.time.Instant;

/**
 * Verified access-token claims. Contains neither a bearer token nor application credentials.
 * @param appId app for which the token was issued
 * @param userId verified Privy user DID
 * @param sessionId verified session ID
 * @param issuedAt token issuance time
 * @param expiresAt token expiration time
 */
public record AuthenticatedUser(
        String appId, String userId, String sessionId, Instant issuedAt, Instant expiresAt) { }
