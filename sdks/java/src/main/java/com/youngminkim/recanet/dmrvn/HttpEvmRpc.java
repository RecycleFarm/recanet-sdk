package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded, timeout-controlled RPC transport without transaction retries. */
public final class HttpEvmRpc implements EvmRpc {
    private final URI uri;
    private final HttpClient client;
    private final Duration timeout;
    private final AtomicLong ids = new AtomicLong();

    public HttpEvmRpc(URI uri) {
        this(
                uri,
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                Duration.ofSeconds(30));
    }

    public HttpEvmRpc(URI uri, HttpClient client, Duration timeout) {
        DmrvnConfig.checkUri(uri);
        require(!timeout.isNegative() && !timeout.isZero(), Code.INVALID_INPUT);
        this.uri = uri;
        this.client = Objects.requireNonNull(client);
        this.timeout = timeout;
    }

    @Override
    public Object call(String method, List<Object> params) {
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
            require(response.statusCode() == 200, Code.RPC_UNAVAILABLE);
            var body = Json.object(response.body());
            require(
                    "2.0".equals(body.get("jsonrpc"))
                            && Long.toString(id).equals(String.valueOf(body.get("id"))),
                    Code.RPC_UNAVAILABLE);
            if (body.containsKey("error"))
                throw new DmrvnException(
                        method.equals("eth_estimateGas") || method.equals("eth_call")
                                ? Code.GAS_ESTIMATION_FAILED
                                : Code.RPC_UNAVAILABLE);
            require(body.containsKey("result"), Code.RPC_UNAVAILABLE);
            return body.get("result");
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new DmrvnException(Code.INTERRUPTED);
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            future.cancel(true);
            throw new DmrvnException(Code.RPC_UNAVAILABLE);
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
