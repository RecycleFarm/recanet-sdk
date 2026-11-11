package com.youngminkim.recanet;

import com.youngminkim.recanet.dmrvn.DmrvnException;
import com.youngminkim.recanet.dmrvn.EvmRpc;
import com.youngminkim.recanet.dmrvn.EvmSigner;
import com.youngminkim.recanet.dmrvn.HttpEvmRpc;

import java.math.BigInteger;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import com.youngminkim.recanet.telemetry.SdkTelemetry;

/** Balance and transfer of the SDK's currently supported asset: Arbitrum Sepolia ETH. */
public final class AssetClient {
    public static final long CHAIN_ID = 421614L;
    public static final String SYMBOL = "ETH";
    public static final int DECIMALS = 18;
    private static final BigInteger MAX_UINT256 = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE);
    private final EvmRpc rpc;
    private final SdkTelemetry telemetry;

    public AssetClient(URI rpcUri) {
        this(new HttpEvmRpc(rpcUri));
    }

    public AssetClient(EvmRpc rpc) {
        this(rpc, SdkTelemetry.local());
    }

    public AssetClient(URI rpcUri, SdkTelemetry telemetry) {
        this(new HttpEvmRpc(rpcUri, telemetry), telemetry);
    }

    public AssetClient(EvmRpc rpc, SdkTelemetry telemetry) {
        this.telemetry = Objects.requireNonNull(telemetry, "telemetry");
        this.rpc = telemetry.instrumentRpc(Objects.requireNonNull(rpc, "rpc"));
    }

    /** Returns the latest confirmed-on-the-RPC balance in wei for a blockchain address. */
    public BigInteger getBalance(String address) {
        return telemetry.observe("AssetClient.getBalance", null,
                () -> getBalanceImpl(address));
    }

    private BigInteger getBalanceImpl(String address) {
        checkAddress(address);
        verifyChain();
        var balance = number(rpc.call("eth_getBalance", List.of(address, "latest")));
        telemetry.checkpoint(SdkTelemetry.State.BALANCE_READ);
        return balance;
    }

    /**
     * Submits one native ETH transfer and returns its transaction hash. The caller must supply
     * a stable, unique idempotency key for this transfer and serialize sends from the same wallet.
     * A returned hash does not imply that the transaction succeeded or was finalized.
     */
    public String transfer(EvmSigner signer, String recipient, BigInteger amountWei, String idempotencyKey) {
        return telemetry.observe("AssetClient.transfer", idempotencyKey,
                () -> transferImpl(signer, recipient, amountWei, idempotencyKey));
    }

    private String transferImpl(EvmSigner signer, String recipient, BigInteger amountWei, String idempotencyKey) {
        Objects.requireNonNull(signer, "signer");
        checkAddress(signer.address());
        checkAddress(recipient);
        if (amountWei == null || amountWei.signum() <= 0 || amountWei.compareTo(MAX_UINT256) > 0
                || idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("A positive uint256 amount and idempotency key are required");
        }
        verifyChain();
        var estimate = Map.<String, Object>of("from", signer.address(), "to", recipient,
                "value", quantity(amountWei), "data", "0x");
        BigInteger gas = number(rpc.call("eth_estimateGas", List.of(estimate)));
        BigInteger price = number(rpc.call("eth_gasPrice", List.of()));
        BigInteger nonce = number(rpc.call("eth_getTransactionCount", List.of(signer.address(), "pending")));
        if (gas.signum() == 0 || price.signum() == 0) throw new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        var transaction = Map.<String, Object>of("to", recipient, "value", quantity(amountWei),
                "data", "0x", "gas", quantity(gas), "gasPrice", quantity(price), "nonce", quantity(nonce));
        return telemetry.step("AssetClient.submitTransaction", () -> {
            telemetry.submissionAttempt();
            String hash = signer.sendTransaction(CHAIN_ID, transaction, idempotencyKey);
            if (hash == null || !hash.matches("0x[0-9a-fA-F]{64}"))
                throw new DmrvnException(DmrvnException.Code.SUBMISSION_UNRESOLVED);
            telemetry.submissionAccepted();
            telemetry.checkpoint(SdkTelemetry.State.SUBMITTED);
            return hash;
        });
    }

    private void verifyChain() {
        if (!number(rpc.call("eth_chainId", List.of())).equals(BigInteger.valueOf(CHAIN_ID)))
            throw new DmrvnException(DmrvnException.Code.WRONG_CHAIN);
        telemetry.checkpoint(SdkTelemetry.State.CHAIN_VERIFIED);
    }

    private static void checkAddress(String address) {
        if (address == null || !address.matches("0x[0-9a-fA-F]{40}"))
            throw new IllegalArgumentException("Invalid EVM address");
    }

    private static BigInteger number(Object value) {
        if (!(value instanceof String s) || !s.matches("0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)") || s.length() > 66)
            throw new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
        return new BigInteger(s.substring(2), 16);
    }

    private static String quantity(BigInteger value) {
        return "0x" + value.toString(16);
    }
}
