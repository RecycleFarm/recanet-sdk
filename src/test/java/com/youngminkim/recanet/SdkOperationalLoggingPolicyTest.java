package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;
import com.youngminkim.recanet.dmrvn.*;
import com.youngminkim.recanet.telemetry.SdkTelemetry;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.Test;

/** Public operations must use the shared compact policy, including standalone transports. */
class SdkOperationalLoggingPolicyTest {
    @Test void credentialsAndSignerRpcFailuresUseSameCompactPolicy() throws Exception {
        try (var capture = new SdkLogWorkflowTest.Capture()) {
            var calls = new java.util.concurrent.atomic.AtomicInteger();
            var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                calls.incrementAndGet();
                exchange.getRequestBody().readAllBytes();
                boolean walletLookup = exchange.getRequestMethod().equals("GET") && exchange.getRequestURI().getPath().equals("/v1/wallets");
                String body = walletLookup
                        ? "{\"data\":[{\"id\":\"wallet-test\",\"address\":\"0x1111111111111111111111111111111111111111\",\"chain_type\":\"ethereum\",\"created_at\":0,\"policy_ids\":[],\"additional_signers\":[]}]}"
                        : "{\"error\":\"Synthetic permission denied\"}";
                byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(walletLookup ? 200 : 403, bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
            try {
                var client = new PrivyClient(new PrivyClientConfig("app", "credential-secret", URI.create(
                        "http://127.0.0.1:" + server.getAddress().getPort()), Duration.ofSeconds(3)).withTelemetry(capture.telemetry));
                var signer = new PrivyEvmSigner(client, "wallet-test", BackendWalletKeyPair.generate().registration());
                var cases = List.of(
                        new Operation("PrivyClient.verifyAppCredentials", client::verifyAppCredentials),
                        new Operation("PrivyEvmSigner.signMessage", () -> signer.signMessage("private-message")),
                        new Operation("PrivyEvmSigner.signTypedData", () -> signer.signTypedData(Map.of(
                                "domain", Map.of("name", "Test", "chainId", 421614),
                                "types", Map.of("Test", List.of(Map.of("name", "amount", "type", "uint256"))),
                                "primaryType", "Test", "message", Map.of("amount", "42")))),
                        new Operation("PrivyEvmSigner.sendTransaction", () -> signer.sendTransaction(421614, Map.of(
                                "to", signer.address(), "value", "0x0", "data", "0x", "gas", "0x5208",
                                "gasPrice", "0x1", "nonce", "0x0"), "send-job")));
                for (var operation : cases) {
                    capture.logs.reset();
                    int before = calls.get();
                    assertThrows(io.privy.api.models.errors.APIException.class, operation.action()::run);
                    assertEquals(before + 1, calls.get(), "No automatic retries");
                    var failures = capture.logs.getFinishedLogRecordItems().stream()
                            .filter(l -> "failed".equals(SdkLogWorkflowTest.attr(l, "recanet.phase"))).toList();
                    assertEquals(1, failures.size());
                    var failure = failures.get(0);
                    assertEquals(operation.root(), SdkLogWorkflowTest.attr(failure, "recanet.operation"));
                    assertEquals("403", SdkLogWorkflowTest.attr(failure, "error.code"));
                    assertEquals("Synthetic permission denied", SdkLogWorkflowTest.attr(failure, "error.message"));
                    assertNull(SdkLogWorkflowTest.attr(failure, "recanet.call_id"));
                    assertFalse(capture.logs.getFinishedLogRecordItems().toString().contains("secret"));
                }
            } finally { server.stop(0); }
        }
    }

    record Operation(String root, Runnable action) {}

    static Map<String, Operation> operations(SdkTelemetry telemetry) {
        var result = new LinkedHashMap<String, Operation>();
        var verification = PrivyTokenVerificationConfig.usingJwks(URI.create("https://unused.example/jwks"));
        var privy = new PrivyClient(new PrivyClientConfig("app", "unused-secret")
                .withTokenVerification(verification).withTelemetry(telemetry));
        var key = BackendWalletKeyPair.generate().registration();
        var wallets = new UserWalletClient(privy, key, "test");
        EvmRpc noRpc = (method, params) -> { throw new AssertionError("Invalid inputs must not invoke RPC"); };
        var assets = new AssetClient(noRpc, telemetry);
        var transactions = new EvmTransactionClient(421614, noRpc, telemetry);
        var verifier = new PrivyTokenVerifier("app", verification, telemetry);
        var storage = new NodeGreenfieldStorage(Path.of("/unused/node"), Path.of("/unused/worker"),
                URI.create("https://unused.example"), "5600", "0x" + "12".repeat(20),
                "RECANET_UNUSED_POLICY_TEST_KEY", null, Duration.ofSeconds(1), telemetry);
        var reader = new GreenfieldPublicReader(URI.create("https://unused.example"), "5600", telemetry);
        var wrongLocation = Map.<String,Object>of("chainId", "wrong", "storageType", 1);
        result.put("PrivyClient.verifyAccessToken", new Operation("PrivyClient.verifyAccessToken", () -> privy.verifyAccessToken("invalid")));
        result.put("PrivyClient.authenticateAuthorizationHeader", new Operation("PrivyClient.authenticateAuthorizationHeader", () -> privy.authenticateAuthorizationHeader("invalid")));
        result.put("PrivyClient.registerBackendWallet", new Operation("PrivyClient.registerBackendWallet", () -> privy.registerBackendWallet(key, null)));
        result.put("PrivyClient.isBackendWallet", new Operation("PrivyClient.isBackendWallet", () -> privy.isBackendWallet("", key)));
        result.put("PrivyClient.listWalletsByAuthorizationKey", new Operation("PrivyClient.listWalletsByAuthorizationKey", () -> privy.listWalletsByAuthorizationKey("")));
        result.put("PrivyClient.ensureBackendWallet", new Operation("PrivyClient.ensureBackendWallet", () -> privy.ensureBackendWallet(null)));
        result.put("PrivyClient.exportWalletPrivateKey", new Operation("PrivyClient.exportWalletPrivateKey", () -> privy.exportWalletPrivateKey("", key)));
        result.put("UserWalletClient.getOrCreateWallet", new Operation("UserWalletClient.getOrCreateWallet", () -> wallets.getOrCreateWallet("")));
        result.put("UserWalletClient.findWallet", new Operation("UserWalletClient.findWallet", () -> wallets.findWallet("")));
        result.put("UserWalletClient.signMessage", new Operation("UserWalletClient.signMessage", () -> wallets.signMessage("member", null)));
        result.put("UserWalletClient.signTypedData", new Operation("UserWalletClient.signTypedData", () -> wallets.signTypedData("member", null)));
        result.put("UserWalletClient.sendTransaction", new Operation("UserWalletClient.sendTransaction", () -> wallets.sendTransaction("member", 0, Map.of(), "job")));
        result.put("UserWalletClient.signerFor", new Operation("UserWalletClient.signerFor", () -> wallets.signerFor("")));
        result.put("PartnerWallet.getOrCreateSigner", new Operation("BeneficiaryWallets.getOrCreateSigner", () -> wallets.forPartner(101, (p,m) -> false).getOrCreateSigner(101, "member")));
        result.put("PrivyTokenVerifier.verifyAccessToken", new Operation("PrivyTokenVerifier.verifyAccessToken", () -> verifier.verifyAccessToken("invalid")));
        result.put("PrivyTokenVerifier.authenticateAuthorizationHeader", new Operation("PrivyTokenVerifier.authenticateAuthorizationHeader", () -> verifier.authenticateAuthorizationHeader("invalid")));
        result.put("AssetClient.getBalance", new Operation("AssetClient.getBalance", () -> assets.getBalance("invalid")));
        result.put("AssetClient.transfer", new Operation("AssetClient.transfer", () -> assets.transfer(null, "", null, "job")));
        result.put("EvmTransactionClient.getTransaction", new Operation("EvmTransactionClient.getTransaction", () -> transactions.getTransaction("invalid")));
        result.put("EvmTransactionClient.getTransactionStatus", new Operation("EvmTransactionClient.getTransactionStatus", () -> transactions.getTransactionStatus("invalid")));
        result.put("EvmTransactionClient.listTransactions.limit", new Operation("EvmTransactionClient.listTransactions", () -> transactions.listTransactions("invalid", 10, null)));
        result.put("EvmTransactionClient.listTransactions.range", new Operation("EvmTransactionClient.listTransactions", () -> transactions.listTransactions("invalid", new EvmTransactionQuery(0, 1L, 10))));
        result.put("GreenfieldStorage.head", new Operation("GreenfieldStorage.head", () -> storage.head(wrongLocation)));
        result.put("GreenfieldStorage.create", new Operation("GreenfieldStorage.create", () -> storage.create(wrongLocation, new byte[0])));
        result.put("GreenfieldStorage.upload", new Operation("GreenfieldStorage.upload", () -> storage.upload(wrongLocation, new byte[0], "hash")));
        result.put("GreenfieldStorage.read", new Operation("GreenfieldStorage.read", () -> storage.read(wrongLocation)));
        result.put("GreenfieldStorage.matchesCreateTransaction", new Operation("GreenfieldStorage.matchesCreateTransaction", () -> storage.matchesCreateTransaction(wrongLocation, "hash")));
        result.put("GreenfieldPublicReader.read", new Operation("GreenfieldPublicReader.read", () -> reader.read(wrongLocation)));
        return result;
    }

    @TestFactory Stream<DynamicTest> publicOperationsPreserveOneErrorWithoutVerboseLifecycleRecords() {
        // These are invalid-input/authorization calls; no remote credentials or spending is used.
        List<String> names;
        try (var c = new SdkLogWorkflowTest.Capture()) { names = List.copyOf(operations(c.telemetry).keySet()); }
        return names.stream().map(name -> DynamicTest.dynamicTest(name, () -> {
            try (var c = new SdkLogWorkflowTest.Capture()) {
                var operation = operations(c.telemetry).get(name);
                assertThrows(RuntimeException.class, operation.action()::run);
                var logs = c.logs.getFinishedLogRecordItems();
                var failures = logs.stream().filter(l -> "failed".equals(SdkLogWorkflowTest.attr(l, "recanet.phase"))).toList();
                assertEquals(1, failures.size());
                var failure = failures.get(0);
                assertEquals(operation.root(), SdkLogWorkflowTest.attr(failure, "recanet.operation"));
                for (String field : List.of("recanet.operation_id", "recanet.failed_stage", "error.code", "error.message",
                        "recanet.last_confirmed_stage", "recanet.last_confirmed_state", "recanet.submission_state"))
                    assertNotNull(SdkLogWorkflowTest.attr(failure, field), field);
                assertTrue(logs.stream().noneMatch(l -> Set.of("started", "completed").contains(SdkLogWorkflowTest.attr(l, "recanet.phase"))));
                assertTrue(logs.stream().allMatch(l -> SdkLogWorkflowTest.attr(l, "recanet.call_id") == null));
                assertTrue(c.spans.getFinishedSpanItems().isEmpty());
            }
        }));
    }
}
