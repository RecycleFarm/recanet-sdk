package com.youngminkim.recanet.dmrvn;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class UpstreamErrorTest {
    @TempDir Path directory;

    @Test void nestedFileJournalLocksDoNotReplaceServiceErrorsWithJournalErrors() {
        var journal = new FileOperationJournal(directory);
        var original = new UpstreamException(UpstreamException.Source.GREENFIELD, 4, 0,
                "original rejection", "original response");
        assertSame(original, assertThrows(UpstreamException.class,
                () -> journal.withLock("activity", () -> journal.withLock("operation", () -> {
                    throw original;
                }))));
    }

    @Test void rpcRevertPreservesCodeMessageDataAndDoesNotRetry() throws Exception {
        String body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32000,"
                + "\"message\":\"execution reverted: member denied\",\"data\":\"0xdeadbeef\"}}";
        var calls = new AtomicInteger();
        var server = server(200, body, calls);
        try {
            var error = assertThrows(UpstreamException.class,
                    () -> new HttpEvmRpc(uri(server)).call("eth_estimateGas", java.util.List.of()));
            assertEquals(UpstreamException.Source.EVM_RPC, error.source());
            assertEquals(-32000, error.code());
            assertEquals(200, error.statusCode());
            assertEquals("execution reverted: member denied", error.getMessage());
            assertEquals(body, error.responseBody());
            assertEquals(1, calls.get());
        } finally { server.stop(0); }
    }

    @Test void rpcHttpFailurePreservesResponseRatherThanBecomingDeploymentNotReady() throws Exception {
        String body = "upstream RPC request limit exceeded";
        var calls = new AtomicInteger();
        var server = server(429, body, calls);
        try {
            var chain = new Chain(TestSupport.proxyConfig(), new HttpEvmRpc(uri(server)));
            var error = assertThrows(UpstreamException.class, chain::verifyDeployment);
            assertEquals(429, error.statusCode());
            assertEquals(body, error.getMessage());
            assertEquals(body, error.responseBody());
            assertEquals(1, calls.get());
        } finally { server.stop(0); }
    }

    @Test void publicGreenfieldReaderPreservesHttpErrorBody() throws Exception {
        String body = "<Error><Code>AccessDenied</Code><Message>Object access denied</Message></Error>";
        var server = server(403, body, new AtomicInteger());
        try {
            var error = assertThrows(UpstreamException.class,
                    () -> new GreenfieldPublicReader(uri(server), "5600").read(location()));
            assertEquals(UpstreamException.Source.GREENFIELD, error.source());
            assertEquals(403, error.statusCode());
            assertEquals(body, error.responseBody());
        } finally { server.stop(0); }
    }

    @Test void workerBoundaryPreservesNumericCodeMessageAndRejectionEvidence() throws Exception {
        // A Java source launcher stands in for the Node process; the stdout protocol is identical.
        String response = "{\"ok\":false,\"code\":4,\"message\":\"original CheckTx rejection\","
                + "\"codespace\":\"sdk\",\"log\":\"original chain log\",\"definitelyRejected\":true}";
        Path worker = directory.resolve("Worker.java");
        Files.writeString(worker, "class Worker { public static void main(String[] args) throws Exception {"
                + "System.in.readAllBytes(); System.out.print(" + Json.canonical(response) + "); }}");
        var storage = new NodeGreenfieldStorage(Path.of(System.getProperty("java.home"), "bin", "java"),
                worker, URI.create("http://127.0.0.1"), "5600", "0x" + "11".repeat(20),
                "PATH", null, Duration.ofSeconds(15));
        var error = assertThrows(UpstreamException.class,
                () -> storage.create(location(), "{}".getBytes(StandardCharsets.UTF_8)));
        assertEquals(4, error.code());
        assertEquals("original CheckTx rejection", error.getMessage());
        assertEquals(response, error.responseBody());
        assertTrue(error.definitelyRejected());
        assertFalse(error.definitelyNotBroadcast());
    }

    private static Map<String, Object> location() {
        return Map.of("storageType", 1, "chainId", "5600", "bucketName", "test", "objectName", "evidence.json");
    }

    private static URI uri(HttpServer server) {
        return URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    }

    private static HttpServer server(int status, String body, AtomicInteger calls) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try (var output = exchange.getResponseBody()) { output.write(bytes); }
        });
        server.start();
        return server;
    }
}
