package com.youngminkim.recanet;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class PrivyHttpTransportTest {
    @Test
    void timesOutEvenWhenHeadersArriveButTheResponseBodyStalls() throws Exception {
        var headersSent = new CountDownLatch(1);
        var releaseBody = new CountDownLatch(1);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/slow", exchange -> {
            exchange.sendResponseHeaders(200, 2);
            try (var output = exchange.getResponseBody()) {
                output.write('a');
                output.flush();
                headersSent.countDown();
                releaseBody.await(5, TimeUnit.SECONDS);
                output.write('b');
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        });
        server.start();
        try {
            var transport = new PrivyHttpTransport(HttpClient.newHttpClient(), Duration.ofSeconds(1));
            assertThrows(HttpTimeoutException.class, () -> transport.send(request(server, "/slow")));
            assertEquals(0, headersSent.getCount());
        } finally {
            releaseBody.countDown();
            server.stop(0);
        }
    }

    @Test
    void boundsResponseBodySize() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/large", exchange -> {
            byte[] bytes = new byte[4 * 1024 * 1024 + 1];
            exchange.sendResponseHeaders(200, bytes.length);
            try (var output = exchange.getResponseBody()) { output.write(bytes); }
        });
        server.start();
        try {
            var transport = new PrivyHttpTransport(HttpClient.newHttpClient(), Duration.ofSeconds(5));
            var error = assertThrows(IOException.class, () -> transport.send(request(server, "/large")));
            assertTrue(error.getMessage().contains("size limit"));
        } finally { server.stop(0); }
    }

    @Test
    void preservesCallerInterruptionAcrossSdkBoundary() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/users", exchange -> { exchange.sendResponseHeaders(503, -1); exchange.close(); });
        server.start();
        try {
            var client = new PrivyClient(new PrivyClientConfig("app", "secret",
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(5)));
            Thread.currentThread().interrupt();
            var failure = assertThrows(RuntimeException.class, client::verifyAppCredentials);
            assertInstanceOf(InterruptedException.class, failure.getCause());
            assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
            server.stop(0);
        }
    }

    private static HttpRequest request(HttpServer server, String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path)).GET().build();
    }
}
