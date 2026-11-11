package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import com.youngminkim.recanet.telemetry.SdkTelemetry;

/** Bounded, timeout-controlled RPC transport without transaction retries. */
public final class HttpEvmRpc implements EvmRpc {
    private static final com.fasterxml.jackson.databind.ObjectMapper ERROR_JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();
    private final URI uri;
    private final HttpClient client;
    private final Duration timeout;
    private final SdkTelemetry telemetry;
    private final AtomicLong ids = new AtomicLong();

    public HttpEvmRpc(URI uri) {
        this(
                uri,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                Duration.ofSeconds(30));
    }

    public HttpEvmRpc(URI uri, HttpClient client, Duration timeout) {
        this(uri, client, timeout, SdkTelemetry.local());
    }

    public HttpEvmRpc(URI uri, SdkTelemetry telemetry) {
        this(uri, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(), Duration.ofSeconds(30), telemetry);
    }

    public HttpEvmRpc(URI uri, HttpClient client, Duration timeout, SdkTelemetry telemetry) {
        DmrvnConfig.checkUri(uri, "rpcUrl");
        require(timeout != null && !timeout.isNegative() && !timeout.isZero(), Code.INVALID_INPUT,
                "rpcTimeout", "must be a positive duration");
        this.uri = uri;
        this.client = Objects.requireNonNull(client);
        this.timeout = timeout;
        this.telemetry = Objects.requireNonNull(telemetry);
    }

    @Override
    public Object call(String method, List<Object> params) {
        return telemetry.instrumentRpc(this::callImpl).call(method, params);
    }

    private Object callImpl(String method, List<Object> params) {
        long id = ids.incrementAndGet();
        var request =
                HttpRequest.newBuilder(uri)
                        .timeout(timeout)
                        .header("Content-Type", "application/json")
                        .POST(
                                HttpRequest.BodyPublishers.ofByteArray(
                                        Json.bytes(
                                                Json.obj(
                                                        "jsonrpc", "2.0", "id", id, "method",
                                                        method, "params", params))))
                        .build();
        var future = client.sendAsync(request, ignored -> new BoundedBody(4 * 1024 * 1024));
        try {
            var response = future.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            String responseText = new String(response.body(), java.nio.charset.StandardCharsets.UTF_8);
            com.fasterxml.jackson.databind.JsonNode envelope = null;
            try {
                envelope = ERROR_JSON.readTree(response.body());
            } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
                if (response.statusCode() == 200) throw error;
            }
            var error = envelope == null ? null : envelope.get("error");
            if (error != null && error.isObject()) {
                var originalCode = error.get("code");
                var originalMessage = error.get("message");
                throw new UpstreamException(UpstreamException.Source.EVM_RPC,
                        originalCode == null || originalCode.isNull() ? null
                                : originalCode.isNumber() ? originalCode.numberValue() : originalCode.asText(),
                        response.statusCode(), originalMessage == null ? null : originalMessage.asText(),
                        responseText);
            }
            if (response.statusCode() != 200)
                throw new UpstreamException(UpstreamException.Source.EVM_RPC, null,
                        response.statusCode(), responseText, responseText);
            var body = Json.object(response.body());
            require(
                    "2.0".equals(body.get("jsonrpc"))
                            && Long.toString(id).equals(String.valueOf(body.get("id"))),
                    Code.RPC_UNAVAILABLE);
            require(body.containsKey("result"), Code.RPC_UNAVAILABLE);
            return body.get("result");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw UpstreamException.transport(UpstreamException.Source.EVM_RPC, e);
        } catch (UpstreamException e) {
            throw e;
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            future.cancel(true);
            throw UpstreamException.transport(UpstreamException.Source.EVM_RPC, e);
        }
    }

    static final class BoundedBody implements HttpResponse.BodySubscriber<byte[]> {
        final int limit;
        final CompletableFuture<byte[]> result = new CompletableFuture<>();
        final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        Flow.Subscription subscription;

        BoundedBody(int limit) {
            this.limit = limit;
        }

        public CompletionStage<byte[]> getBody() {
            return result;
        }

        public void onSubscribe(Flow.Subscription s) {
            subscription = s;
            s.request(1);
        }

        public void onNext(List<ByteBuffer> values) {
            for (var b : values) {
                if (b.remaining() > limit - bytes.size()) {
                    subscription.cancel();
                    result.completeExceptionally(new IllegalStateException());
                    return;
                }
                byte[] chunk = new byte[b.remaining()];
                b.get(chunk);
                bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }

        public void onError(Throwable t) {
            result.completeExceptionally(t);
        }

        public void onComplete() {
            result.complete(bytes.toByteArray());
        }
    }
}
