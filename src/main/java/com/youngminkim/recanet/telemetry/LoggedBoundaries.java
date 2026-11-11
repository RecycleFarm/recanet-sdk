package com.youngminkim.recanet.telemetry;

import com.youngminkim.recanet.dmrvn.EvmRpc;
import com.youngminkim.recanet.dmrvn.EvmSigner;
import com.youngminkim.recanet.dmrvn.GreenfieldStorage;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Stage names contain only known method names, never endpoints, keys, parameters or results. */
final class LoggedBoundaries {
    private static final Set<String> RPC_METHODS = Set.of("eth_chainId", "eth_getBalance",
            "eth_estimateGas", "eth_gasPrice", "eth_getTransactionCount", "eth_call", "eth_getCode",
            "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs",
            "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_sendRawTransaction");

    private LoggedBoundaries() {}

    static String rpcName(String method) {
        return method != null && RPC_METHODS.contains(method) ? "EvmRpc." + method : "EvmRpc.call";
    }

    static EvmRpc rpc(SdkTelemetry telemetry, EvmRpc delegate) {
        return delegate instanceof Rpc r && r.telemetry == telemetry ? delegate : new Rpc(telemetry, delegate);
    }
    static EvmSigner signer(SdkTelemetry telemetry, EvmSigner delegate) {
        return delegate == null || (delegate instanceof Signer s && s.telemetry == telemetry)
                ? delegate : new Signer(telemetry, delegate);
    }
    static GreenfieldStorage storage(SdkTelemetry telemetry, GreenfieldStorage delegate) {
        return delegate instanceof Storage s && s.telemetry == telemetry ? delegate : new Storage(telemetry, delegate);
    }

    private record Rpc(SdkTelemetry telemetry, EvmRpc delegate) implements EvmRpc {
        @Override public Object call(String method, List<Object> params) {
            String name = rpcName(method);
            return telemetry.step(name, () -> {
                if ("eth_sendRawTransaction".equals(method)) telemetry.submissionAttempt();
                Object result = delegate.call(method, params);
                if ("eth_sendRawTransaction".equals(method) && result instanceof String hash
                        && hash.matches("0x[0-9a-fA-F]{64}")) {
                    telemetry.submissionAccepted();
                    telemetry.checkpoint(SdkTelemetry.State.SUBMITTED);
                }
                return result;
            });
        }
    }

    private record Signer(SdkTelemetry telemetry, EvmSigner delegate) implements EvmSigner {
        @Override public String address() { return delegate.address(); }
        @Override public String signMessage(String message) {
            return telemetry.step("EvmSigner.signMessage", () -> {
                String result = delegate.signMessage(message);
                if (result != null) telemetry.checkpoint(SdkTelemetry.State.SIGNATURE_CREATED);
                return result;
            });
        }
        @Override public String signTypedData(Map<String, Object> data) {
            return telemetry.step("EvmSigner.signTypedData", () -> {
                String result = delegate.signTypedData(data);
                if (result != null) telemetry.checkpoint(SdkTelemetry.State.SIGNATURE_CREATED);
                return result;
            });
        }
        @Override public String sendTransaction(long chain, Map<String, Object> tx, String key) {
            return telemetry.step("EvmSigner.sendTransaction", () -> {
                telemetry.submissionAttempt();
                String hash = delegate.sendTransaction(chain, tx, key);
                if (hash != null && hash.matches("0x[0-9a-fA-F]{64}")) {
                    telemetry.submissionAccepted();
                    telemetry.checkpoint(SdkTelemetry.State.SUBMITTED);
                }
                return hash;
            });
        }
    }

    private record Storage(SdkTelemetry telemetry, GreenfieldStorage delegate) implements GreenfieldStorage {
        @Override public String address() { return delegate.address(); }
        @Override public String chainId() { return delegate.chainId(); }
        @Override public Head head(Map<String, Object> location) {
            return telemetry.step("GreenfieldStorage.head", () -> delegate.head(location));
        }
        @Override public String create(Map<String, Object> location, byte[] bytes) {
            return telemetry.step("GreenfieldStorage.create", () -> {
                telemetry.submissionAttempt();
                String hash = delegate.create(location, bytes);
                if (hash != null && !hash.isBlank()) {
                    telemetry.submissionAccepted();
                    telemetry.checkpoint(SdkTelemetry.State.EVIDENCE_CREATE_BROADCAST);
                }
                return hash;
            });
        }
        @Override public void upload(Map<String, Object> location, byte[] bytes, String tx) {
            telemetry.step("GreenfieldStorage.upload", () -> {
                telemetry.submissionAttempt();
                delegate.upload(location, bytes, tx);
                telemetry.submissionAccepted();
                return null;
            });
        }
        @Override public byte[] read(Map<String, Object> location) {
            return telemetry.step("GreenfieldStorage.read", () -> delegate.read(location));
        }
        @Override public boolean matchesCreateTransaction(Map<String, Object> location, String tx) {
            return telemetry.step("GreenfieldStorage.matchesCreateTransaction",
                    () -> delegate.matchesCreateTransaction(location, tx));
        }
    }
}
