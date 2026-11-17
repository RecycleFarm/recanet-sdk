package com.youngminkim.recanet;

/** Non-secret metadata for a service member's backend-controlled EVM wallet. */
public record UserWallet(String userId, String id, String address, String chainType) { }
