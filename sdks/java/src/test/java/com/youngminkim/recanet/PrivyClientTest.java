package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.sun.net.httpserver.HttpServer;
import io.privy.api.models.errors.APIException;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class PrivyClientTest {
    @Test
    void officialSdkUsesConfiguredOriginAndCredentialsAndParsesResponse() throws Exception {
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> appId = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/wallets/wallet-test", exchange -> {
            method.set(exchange.getRequestMethod());
            appId.set(exchange.getRequestHeaders().getFirst("privy-app-id"));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = """
                    {"id":"wallet-test","address":"0x0000000000000000000000000000000000000001",
                     "created_at":0,"chain_type":"ethereum","policy_ids":[],
                     "owner_id":null,"additional_signers":[],"exported_at":null,"imported_at":null}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.createContext("/v1/wallets/missing", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        server.start();
        try {
            PrivyClient client = new PrivyClient(new PrivyClientConfig(
                    "app", "secret",
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
                    Duration.ofSeconds(5)));

            var response = client.sdk().wallets().retrieve("wallet-test");
            assertEquals("wallet-test", response.wallet().orElseThrow().id());
            assertEquals(Duration.ofSeconds(5), response.rawResponse().request().timeout().orElseThrow());
            assertEquals("GET", method.get());
            assertEquals("app", appId.get());
            assertEquals("Basic YXBwOnNlY3JldA==", authorization.get());
            APIException error = assertThrows(APIException.class,
                    () -> client.sdk().wallets().retrieve("missing"));
            assertEquals(404, error.code());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsInvalidConnectionSettingsBeforeInitializingSdk() {
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig(" ", "secret"));
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig("app", " "));
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig(
                "app", "secret", URI.create("https://api.privy.io/v1"), Duration.ofSeconds(5)));
        assertThrows(IllegalArgumentException.class, () -> new PrivyClientConfig(
                "app", "secret", URI.create("https://api.privy.io"), Duration.ZERO));
    }
}
