package com.youngminkim.recanet;

import io.privy.api.utils.HTTPClient;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.net.ssl.SSLSession;

/** Internal bridge between the application's HTTP client and Privy's transport interface. */
final class PrivyHttpTransport implements HTTPClient {
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    private final HttpClient client;
    private final Duration requestTimeout;

    /**
     * Creates a transport with a default timeout for each SDK request.
     * @param client HTTP client used to send requests
     * @param requestTimeout default timeout when the SDK request has none
     */
    PrivyHttpTransport(HttpClient client, Duration requestTimeout) {
        this.client = Objects.requireNonNull(client, "httpClient");
        this.requestTimeout = Objects.requireNonNull(requestTimeout, "requestTimeout");
    }

    @Override
    public HttpResponse<InputStream> send(HttpRequest request) throws IOException, InterruptedException {
        Duration timeout = request.timeout().orElse(requestTimeout);
        HttpRequest timedRequest = HttpRequest.newBuilder(request, (name, value) -> true)
                .timeout(timeout)
                .build();
        var pending = client.sendAsync(timedRequest, response -> new BoundedBodySubscriber());
        try {
            return new BufferedResponse(pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS));
        } catch (TimeoutException e) {
            pending.cancel(true);
            throw new HttpTimeoutException("Privy response exceeded the request timeout");
        } catch (InterruptedException e) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw e;
        } catch (ExecutionException e) {
            if (e.getCause() instanceof IOException io) throw io;
            throw new IOException(e.getCause().getMessage(), e.getCause());
        }
    }

    private static final class BoundedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> body = new CompletableFuture<>();
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private Flow.Subscription subscription;

        @Override
        public CompletionStage<byte[]> getBody() { return body; }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(1);
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            if (body.isDone()) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > MAX_RESPONSE_BYTES - bytes.size()) {
                    subscription.cancel();
                    body.completeExceptionally(new IOException("Privy response exceeded the size limit"));
                    return;
                }
                byte[] chunk = new byte[buffer.remaining()];
                buffer.get(chunk);
                bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }

        @Override
        public void onError(Throwable error) { body.completeExceptionally(error); }

        @Override
        public void onComplete() { body.complete(bytes.toByteArray()); }
    }

    private static final class BufferedResponse implements HttpResponse<InputStream> {
        private final HttpResponse<byte[]> response;
        private final InputStream body;

        private BufferedResponse(HttpResponse<byte[]> response) {
            this.response = response;
            this.body = new ByteArrayInputStream(response.body() == null ? new byte[0] : response.body());
        }

        @Override public int statusCode() { return response.statusCode(); }
        @Override public HttpRequest request() { return response.request(); }
        @Override public Optional<HttpResponse<InputStream>> previousResponse() {
            return response.previousResponse().map(BufferedResponse::new);
        }
        @Override public HttpHeaders headers() { return response.headers(); }
        @Override public InputStream body() { return body; }
        @Override public Optional<SSLSession> sslSession() { return response.sslSession(); }
        @Override public URI uri() { return response.uri(); }
        @Override public HttpClient.Version version() { return response.version(); }
    }
}
