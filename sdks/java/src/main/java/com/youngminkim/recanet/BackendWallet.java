package com.youngminkim.recanet;

/** Public metadata for a wallet registered as backend-owned. */
public record BackendWallet(String id, String address, String publicKey, String chainType) { }
