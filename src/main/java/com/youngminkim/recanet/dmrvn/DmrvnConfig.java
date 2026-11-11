package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.math.BigInteger;
import java.net.URI;

/** Explicit deployment, storage namespace and transaction spending limits. */
public record DmrvnConfig(
        long chainId,
        URI rpcUrl,
        String claimAddress,
        String forwarderAddress,
        String claimRuntimeCodeHash,
        String greenfieldChainId,
        String bucketName,
        String objectPrefix,
        long partnerId,
        BigInteger maxRelayCostWei,
        int confirmations,
        DmrvnDeployment deployment) {
    public DmrvnConfig {
        require(chainId > 0 && chainId <= 9007199254740991L, Code.INVALID_INPUT,
                "chainId", "must be between 1 and 9007199254740991 inclusive");
        checkUri(rpcUrl, "rpcUrl");
        claimAddress = Crypto.address(claimAddress, "claimAddress");
        forwarderAddress = Crypto.address(forwarderAddress, "forwarderAddress");
        claimRuntimeCodeHash = Crypto.bytes32(claimRuntimeCodeHash, "claimRuntimeCodeHash");
        require(
                deployment != null
                        && deployment.chainId() == chainId
                        && deployment.contractAddress().equals(claimAddress)
                        && deployment.forwarderAddress().equals(forwarderAddress)
                        && deployment.runtimeCodeHash().equals(claimRuntimeCodeHash),
                Code.DEPLOYMENT_NOT_READY);
        Crypto.uint(greenfieldChainId, 64, "greenfieldChainId");
        require(
                bucketName != null && bucketName.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"),
                Code.INVALID_INPUT, "bucketName", "must contain 3 to 63 lowercase letters, digits, dots or hyphens and start and end with a letter or digit");
        require(
                objectPrefix != null
                        && !objectPrefix.isBlank()
                        && objectPrefix.endsWith("/")
                        && !objectPrefix.startsWith("/")
                        && !objectPrefix.contains(".."),
                Code.INVALID_INPUT, "objectPrefix", "must be non-blank, end with /, not start with / and not contain ..");
        require(
                partnerId > 0
                        && partnerId <= 0xffffffffL,
                Code.INVALID_INPUT, "partnerId", "must be between 1 and 4294967295 inclusive");
        require(maxRelayCostWei != null && maxRelayCostWei.signum() > 0,
                Code.INVALID_INPUT, "maxRelayCostWei", "must be a positive integer");
        require(confirmations >= 1, Code.INVALID_INPUT, "confirmations", "must be at least 1");
    }

    public static DmrvnConfig petTestnet(
            long partnerId, String prefix, BigInteger maxRelayCostWei) {
        return testnet(DmrvnDeployment.testnet(), partnerId, prefix, maxRelayCostWei);
    }

    public static DmrvnConfig historicalDirectTestnet(
            long partnerId, String prefix, BigInteger maxRelayCostWei) {
        return testnet(
                DmrvnDeployment.historicalDirectTestnet(), partnerId, prefix, maxRelayCostWei);
    }

    private static DmrvnConfig testnet(
            DmrvnDeployment deployment, long partnerId, String prefix, BigInteger maxRelayCostWei) {
        return fromDeployment(
                deployment,
                URI.create("https://sepolia-rollup.arbitrum.io/rpc"),
                "5600",
                "dmrvn",
                prefix,
                partnerId,
                maxRelayCostWei,
                1);
    }

    public static DmrvnConfig fromDeployment(
            DmrvnDeployment deployment,
            URI rpcUrl,
            String greenfieldChainId,
            String bucketName,
            String objectPrefix,
            long partnerId,
            BigInteger maxRelayCostWei,
            int confirmations) {
        return new DmrvnConfig(
                deployment.chainId(),
                rpcUrl,
                deployment.contractAddress(),
                deployment.forwarderAddress(),
                deployment.runtimeCodeHash(),
                greenfieldChainId,
                bucketName,
                objectPrefix,
                partnerId,
                maxRelayCostWei,
                confirmations,
                deployment);
    }

    /**
     * Compatibility constructor for the historical testnet deployment, never a new write target.
     */
    @Deprecated
    public DmrvnConfig(
            long chainId,
            URI rpcUrl,
            String claimAddress,
            String forwarderAddress,
            String claimRuntimeCodeHash,
            String greenfieldChainId,
            String bucketName,
            String objectPrefix,
            long partnerId,
            BigInteger maxRelayCostWei,
            int confirmations) {
        this(
                chainId,
                rpcUrl,
                claimAddress,
                forwarderAddress,
                claimRuntimeCodeHash,
                greenfieldChainId,
                bucketName,
                objectPrefix,
                partnerId,
                maxRelayCostWei,
                confirmations,
                DmrvnDeployment.historicalDirectTestnet());
    }

    public String deploymentId() {
        return chainId + ":" + claimAddress;
    }

    static void checkUri(URI uri) {
        checkUri(uri, "endpoint");
    }

    static void checkUri(URI uri, String field) {
        require(
                uri != null
                        && uri.getHost() != null
                        && uri.getUserInfo() == null
                        && uri.getFragment() == null
                        && ("https".equals(uri.getScheme())
                                || ("http".equals(uri.getScheme())
                                        && java.util.Set.of("localhost", "127.0.0.1", "[::1]")
                                                .contains(uri.getHost()))),
                Code.INVALID_INPUT, field, "must be an HTTPS URL with a host and without user info or a fragment; HTTP is allowed only on loopback hosts");
    }

    void checkObject(String name) {
        require(
                name != null
                        && name.startsWith(objectPrefix)
                        && name.length() > objectPrefix.length()
                        && name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 1024
                        && !name.contains("..")
                        && name.chars().noneMatch(Character::isISOControl),
                Code.INVALID_INPUT, "objectName", "must be inside objectPrefix, contain a non-empty suffix, be at most 1024 UTF-8 bytes and contain neither .. nor control characters");
    }
}
