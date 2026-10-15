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
        require(chainId > 0 && chainId <= 9007199254740991L, Code.INVALID_INPUT);
        checkUri(rpcUrl);
        claimAddress = Crypto.address(claimAddress);
        forwarderAddress = Crypto.address(forwarderAddress);
        claimRuntimeCodeHash = Crypto.bytes32(claimRuntimeCodeHash);
        require(
                deployment != null
                        && deployment.chainId() == chainId
                        && deployment.contractAddress().equals(claimAddress)
                        && deployment.forwarderAddress().equals(forwarderAddress)
                        && deployment.runtimeCodeHash().equals(claimRuntimeCodeHash),
                Code.DEPLOYMENT_NOT_READY);
        Crypto.uint(greenfieldChainId, 64);
        require(
                bucketName != null && bucketName.matches("[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]"),
                Code.INVALID_INPUT);
        require(
                objectPrefix != null
                        && !objectPrefix.isBlank()
                        && objectPrefix.endsWith("/")
                        && !objectPrefix.startsWith("/")
                        && !objectPrefix.contains(".."),
                Code.INVALID_INPUT);
        require(
                partnerId > 0
                        && partnerId <= 0xffffffffL
                        && maxRelayCostWei != null
                        && maxRelayCostWei.signum() > 0
                        && confirmations >= 1,
                Code.INVALID_INPUT);
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
        require(
                uri != null
                        && uri.getHost() != null
                        && uri.getUserInfo() == null
                        && uri.getFragment() == null
                        && ("https".equals(uri.getScheme())
                                || ("http".equals(uri.getScheme())
                                        && java.util.Set.of("localhost", "127.0.0.1", "[::1]")
                                                .contains(uri.getHost()))),
                Code.INVALID_INPUT);
    }

    void checkObject(String name) {
        require(
                name != null
                        && name.startsWith(objectPrefix)
                        && name.length() > objectPrefix.length()
                        && name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= 1024
                        && !name.contains("..")
                        && name.chars().noneMatch(Character::isISOControl),
                Code.INVALID_INPUT);
    }
}
