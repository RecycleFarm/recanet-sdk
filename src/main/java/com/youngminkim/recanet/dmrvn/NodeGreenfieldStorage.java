package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import com.youngminkim.recanet.telemetry.SdkTelemetry;

/**
 * Uses the bundled official Greenfield JS SDK worker (Node >=22); no EVM/Privy secrets are passed.
 */
public final class NodeGreenfieldStorage implements GreenfieldStorage {
    private final Path node, worker;
    private final URI rpc;
    private final String chain, address, keyEnv, feeGranter;
    private final Duration timeout;
    private final SdkTelemetry telemetry;

    public NodeGreenfieldStorage(
            Path node,
            Path worker,
            URI rpc,
            String chainId,
            String address,
            String keyEnvironmentVariable,
            String feeGranter,
            Duration timeout) {
        this(node, worker, rpc, chainId, address, keyEnvironmentVariable, feeGranter, timeout, SdkTelemetry.local());
    }

    public NodeGreenfieldStorage(Path node, Path worker, URI rpc, String chainId, String address,
                                 String keyEnvironmentVariable, String feeGranter, Duration timeout,
                                 SdkTelemetry telemetry) {
        this.telemetry = Objects.requireNonNull(telemetry);
        this.node = node.toAbsolutePath();
        this.worker = worker.toAbsolutePath();
        DmrvnConfig.checkUri(rpc, "greenfieldRpcUrl");
        this.rpc = rpc;
        this.chain = Crypto.uint(chainId, 64, "greenfieldChainId").toString();
        this.address = Crypto.address(address, "storage.address");
        this.keyEnv = Objects.requireNonNull(keyEnvironmentVariable);
        this.feeGranter =
                feeGranter == null || feeGranter.isEmpty() ? "" : Crypto.address(feeGranter, "feeGranter");
        this.timeout = timeout;
        require(timeout != null && timeout.toMillis() > 0, Code.INVALID_INPUT,
                "workerTimeout", "must be at least 1 millisecond");
    }

    @Override
    public String address() {
        return address;
    }

    @Override
    public String chainId() {
        return chain;
    }

    @Override
    public Head head(Map<String, Object> location) {
        return telemetry.step("GreenfieldStorage.head", () -> headImpl(location));
    }

    private Head headImpl(Map<String, Object> location) {
        var r = invoke("head", location, null, null);
        return new Head(Boolean.TRUE.equals(r.get("exists")), Boolean.TRUE.equals(r.get("sealed")));
    }

    @Override
    public String create(Map<String, Object> location, byte[] bytes) {
        return telemetry.step("GreenfieldStorage.create", () -> {
            telemetry.submissionAttempt();
            String hash = Json.str(invoke("create", location, bytes, null).get("createTxHash"), "createTxHash");
            if (!hash.isBlank()) {
                telemetry.submissionAccepted();
                telemetry.checkpoint(SdkTelemetry.State.EVIDENCE_CREATE_BROADCAST);
            }
            return hash;
        });
    }

    @Override
    public void upload(Map<String, Object> location, byte[] bytes, String hash) {
        telemetry.step("GreenfieldStorage.upload", () -> {
            telemetry.submissionAttempt();
            invoke("upload", location, bytes, hash);
            telemetry.submissionAccepted();
            return null;
        });
    }

    @Override
    public byte[] read(Map<String, Object> location) {
        return telemetry.step("GreenfieldStorage.read", () -> Base64.getDecoder()
                .decode(Json.str(invoke("read", location, null, null).get("bytes"), "bytes")));
    }

    @Override
    public boolean matchesCreateTransaction(Map<String, Object> location, String hash) {
        return telemetry.step("GreenfieldStorage.matchesCreateTransaction",
                () -> Boolean.TRUE.equals(invoke("verifyCreate", location, null, hash).get("matches")));
    }

    private Map<String, Object> invoke(
            String op, Map<String, Object> location, byte[] bytes, String hash) {
        require(chain.equals(location.get("chainId")), Code.WRONG_CHAIN);
        String secret = System.getenv(keyEnv);
        require(secret != null && !secret.isBlank(), Code.STORAGE_ACCESS_DENIED);
        var request =
                Json.obj(
                        "op",
                        op,
                        "rpcUrl",
                        rpc.toString(),
                        "chainId",
                        chain,
                        "address",
                        address,
                        "feeGranter",
                        feeGranter,
                        "location",
                        location,
                        "createTxHash",
                        hash);
        if (bytes != null) request.put("bytes", Base64.getEncoder().encodeToString(bytes));
        Process process = null;
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            var builder = new ProcessBuilder(node.toString(), worker.toString());
            builder.environment().clear();
            builder.environment().put("GREENFIELD_STORAGE_PRIVATE_KEY", secret);
            // Worker emits only protocol JSON; dependency stderr is deliberately not exposed.
            builder.redirectError(ProcessBuilder.Redirect.DISCARD);
            process = builder.start();
            Process running = process;
            var output =
                    executor.submit(
                            () -> {
                                try (var in = running.getInputStream()) {
                                    byte[] data = in.readNBytes(6 * 1024 * 1024 + 1);
                                    require(
                                            data.length <= 6 * 1024 * 1024,
                                            Code.STORAGE_UNAVAILABLE);
                                    return data;
                                }
                            });
            try (var in = process.getOutputStream()) {
                in.write(Json.bytes(request));
            }
            byte[] response = output.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            require(process.waitFor(1000, TimeUnit.MILLISECONDS), Code.STORAGE_UNAVAILABLE);
            var result = Json.map(new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(response, Object.class));
            if (!Boolean.TRUE.equals(result.get("ok"))) {
                Object status = result.get("statusCode");
                throw new UpstreamException(
                        UpstreamException.Source.GREENFIELD, result.get("code"),
                        status instanceof Number n ? n.intValue() : 0,
                        (String) result.get("message"),
                        new String(response, java.nio.charset.StandardCharsets.UTF_8),
                        "create".equals(op)
                                && Boolean.TRUE.equals(result.get("definitelyNotBroadcast")),
                        "create".equals(op)
                                && Boolean.TRUE.equals(result.get("definitelyRejected")));
            }
            return Json.map(result.get("data"), "data");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw UpstreamException.transport(UpstreamException.Source.GREENFIELD, e);
        } catch (UpstreamException e) {
            throw e;
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            throw UpstreamException.transport(UpstreamException.Source.GREENFIELD, e);
        } finally {
            if (process != null) process.destroyForcibly();
            executor.shutdownNow();
        }
    }
}
