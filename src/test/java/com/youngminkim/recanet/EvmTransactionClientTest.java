package com.youngminkim.recanet;

import static org.junit.jupiter.api.Assertions.*;
import static com.youngminkim.recanet.EvmTransactionStatus.State.*;
import static com.youngminkim.recanet.TransactionQueryException.Code.*;

import com.sun.net.httpserver.HttpServer;
import com.youngminkim.recanet.dmrvn.EvmRpc;
import com.youngminkim.recanet.dmrvn.Json;

import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class EvmTransactionClientTest {
    private static final String WALLET = "0x" + "ab".repeat(20);
    private static final String OTHER = "0x" + "cd".repeat(20);
    private static final String TX = hash(1);

    @Test
    void detailPreservesExactAmountsFeesCalldataAndDeeplyImmutableReceipt() {
        var rpc = new Fixture();
        var tx = rpc.add(8, 0, WALLET, OTHER, "0x1");
        tx.put("value", "0xffffffffffffffffffffffffffffffff");
        tx.put("input", "0xabcdef00");
        tx.put("maxFeePerGas", "0x123");
        tx.put("maxPriorityFeePerGas", "0x45");
        var topics = new ArrayList<>(List.of(hash(123)));
        var log = new LinkedHashMap<String, Object>(Map.of("address", OTHER, "topics", topics, "data", "0x"));
        rpc.receipts.get(TX).put("logs", new ArrayList<>(List.of(log)));
        rpc.receipts.get(TX).put("l1Fee", "0x789");
        var result = rpc.client().getTransaction(TX).orElseThrow();

        assertEquals(new BigInteger("ffffffffffffffffffffffffffffffff", 16), result.valueWei());
        assertEquals(new BigInteger("123", 16), result.maxFeePerGasWei());
        assertEquals("0xabcdef00", result.input());
        assertEquals(SUCCEEDED, result.status().state());
        assertEquals(3, result.status().confirmations());
        assertEquals("0x789", result.receipt().get("l1Fee"));
        assertThrows(UnsupportedOperationException.class, () -> result.transaction().put("from", OTHER));
        var resultLogs = (List<?>) result.receipt().get("logs");
        var resultTopics = (List<?>) ((Map<?, ?>) resultLogs.get(0)).get("topics");
        assertThrows(UnsupportedOperationException.class, resultTopics::clear);
        topics.clear();
        tx.put("input", "0x");
        assertEquals(1, resultTopics.size());
        assertEquals("0xabcdef00", result.transaction().get("input"));
    }

    @ParameterizedTest
    @CsvSource({"0x1,SUCCEEDED", "0x0,REVERTED"})
    void statusUsesReceiptExecutionResult(String receiptStatus, EvmTransactionStatus.State expected) {
        var rpc = new Fixture();
        rpc.add(10, 0, WALLET, null, receiptStatus);
        var result = rpc.client().getTransaction(TX).orElseThrow();
        assertNull(result.to());
        assertEquals(1, result.status().confirmations());
        assertEquals(expected, rpc.client().getTransactionStatus(TX).state());
    }

    @Test
    void distinguishesUnknownPendingAndMinedWithoutExecutionStatus() {
        var rpc = new Fixture();
        assertTrue(rpc.client().getTransaction(TX).isEmpty());
        assertEquals(NOT_FOUND, rpc.client().getTransactionStatus(TX).state());

        var tx = rpc.add(8, 0, WALLET, OTHER, "0x1");
        rpc.receipts.remove(TX);
        assertEquals(MINED, rpc.client().getTransactionStatus(TX).state());
        tx.put("blockNumber", null);
        tx.put("blockHash", null);
        tx.put("transactionIndex", null);
        var pending = rpc.client().getTransactionStatus(TX);
        assertEquals(PENDING, pending.state());
        assertNull(pending.blockNumber());
        assertEquals(0, pending.confirmations());
        assertNull(rpc.client().getTransaction(TX).orElseThrow().receipt());
    }

    @Test
    void supportsHistoricalReceiptsWithoutInventingAnExecutionResult() {
        var rpc = new Fixture();
        rpc.add(8, 0, WALLET, OTHER, "0x1");
        rpc.receipts.get(TX).remove("status");
        rpc.receipts.get(TX).put("root", hash(50));
        assertEquals(MINED, rpc.client().getTransactionStatus(TX).state());
    }

    @Test
    void paginatesWithinBlocksWithoutDuplicatesAndFiltersOnlyTopLevelSender() {
        var rpc = new Fixture();
        rpc.add(10, 0, WALLET, OTHER, "0x1");
        rpc.add(10, 1, OTHER, WALLET, "0x1"); // Incoming; must be excluded.
        var reverted = rpc.add(10, 2, WALLET, OTHER, "0x0");
        reverted.put("input", "0xaabbccdd"); // Contract call; must be included even if reverted.
        rpc.add(9, 0, WALLET, null, "0x1"); // Contract creation.
        var query = new EvmTransactionQuery(9, 10L, 1);

        var page1 = rpc.client().listTransactions("0x" + "AB".repeat(20), query);
        assertEquals(hash(3), page1.transactions().get(0).hash());
        assertEquals(REVERTED, page1.transactions().get(0).status().state());
        assertNotNull(page1.nextCursor());
        var page2 = rpc.client().listTransactions(WALLET, query.withCursor(page1.nextCursor()));
        assertEquals(TX, page2.transactions().get(0).hash());
        var page3 = rpc.client().listTransactions(WALLET, query.withCursor(page2.nextCursor()));
        assertEquals(hash(4), page3.transactions().get(0).hash());
        assertNull(page3.transactions().get(0).to());
        assertNull(page3.nextCursor());
        assertThrows(UnsupportedOperationException.class, () -> page3.transactions().clear());
    }

    @Test
    void emptyPageHasContinuationAndNewBlocksDoNotShiftTheSnapshot() {
        var rpc = new Fixture();
        rpc.head = 200;
        rpc.add(100, 0, WALLET, OTHER, "0x1");
        var query = new EvmTransactionQuery(100, null, 20);
        var page1 = rpc.client().listTransactions(WALLET, query);
        assertTrue(page1.transactions().isEmpty());
        assertEquals(100, page1.scannedBlocks());
        assertEquals(200, page1.toBlock());
        assertNotNull(page1.nextCursor());

        rpc.head = 201;
        rpc.add(201, 0, WALLET, OTHER, "0x1");
        var page2 = rpc.client().listTransactions(WALLET, query.withCursor(page1.nextCursor()));
        assertEquals(List.of(TX), page2.transactions().stream().map(EvmTransaction::hash).toList());
        assertEquals(200, page2.toBlock());
        assertEquals(1, page2.scannedBlocks());
        assertNull(page2.nextCursor());
    }

    @Test
    void scansGenesisExactlyOnceAndDoesNotRequireTheWalletToExistInPrivy() {
        var rpc = new Fixture();
        rpc.head = 0;
        rpc.add(0, 0, WALLET, OTHER, "0x1");
        var page = rpc.client().listTransactions(WALLET, 10, null);
        assertEquals(1, page.transactions().size());
        assertEquals(1, page.scannedBlocks());
        assertNull(page.nextCursor());
    }

    @Test
    void rejectsCursorForAnotherWalletRangeOrChainBeforeNetworkAccess() {
        var rpc = new Fixture();
        rpc.add(10, 0, WALLET, OTHER, "0x1");
        rpc.add(10, 1, WALLET, OTHER, "0x1");
        var query = new EvmTransactionQuery(0, null, 1);
        String cursor = rpc.client().listTransactions(WALLET, query).nextCursor();
        int calls = rpc.methods.size();
        assertThrows(IllegalArgumentException.class,
                () -> rpc.client().listTransactions(OTHER, query.withCursor(cursor)));
        assertThrows(IllegalArgumentException.class,
                () -> rpc.client().listTransactions(WALLET, new EvmTransactionQuery(1, null, 1, cursor)));
        assertThrows(IllegalArgumentException.class,
                () -> new EvmTransactionClient(2, rpc).listTransactions(WALLET, query.withCursor(cursor)));
        assertThrows(IllegalArgumentException.class,
                () -> rpc.client().listTransactions(WALLET, query.withCursor("not-a-cursor")));
        assertEquals(calls, rpc.methods.size());
    }

    @Test
    void rejectsReorganizationBetweenPagesAndDuringPageRead() {
        var rpc = new Fixture();
        rpc.add(10, 0, WALLET, OTHER, "0x1");
        rpc.add(10, 1, WALLET, OTHER, "0x1");
        var query = new EvmTransactionQuery(0, null, 1);
        var page = rpc.client().listTransactions(WALLET, query);
        rpc.changed = true;
        assertCode(CHAIN_CHANGED, () -> rpc.client().listTransactions(WALLET, query.withCursor(page.nextCursor())));

        rpc.changed = false;
        EvmRpc changing = (method, params) -> {
            Object result = rpc.call(method, params);
            if (method.equals("eth_getTransactionReceipt")) rpc.changed = true;
            return result;
        };
        assertCode(CHAIN_CHANGED, () -> new EvmTransactionClient(1, changing).listTransactions(WALLET, query));
    }

    @Test
    void rejectsMismatchedReceiptsAndInvalidStatusesInsteadOfClaimingSuccess() {
        var rpc = new Fixture();
        rpc.add(8, 0, WALLET, OTHER, "0x1");
        rpc.receipts.get(TX).put("transactionHash", hash(999));
        assertCode(INVALID_RESPONSE, () -> rpc.client().getTransactionStatus(TX));
        rpc.receipts.get(TX).put("transactionHash", TX);
        rpc.receipts.get(TX).put("blockHash", hash(999));
        assertCode(CHAIN_CHANGED, () -> rpc.client().getTransaction(TX));
        rpc.receipts.get(TX).put("blockHash", blockHash(8));
        rpc.receipts.get(TX).put("status", "0x2");
        assertCode(INVALID_RESPONSE, () -> rpc.client().getTransactionStatus(TX));
    }

    @Test
    void unavailableHistoricalBlocksAndRpcFailuresAreNotEmptyOrNotFound() {
        var rpc = new Fixture();
        EvmRpc missingBlock = (method, params) -> method.equals("eth_getBlockByNumber") ? null : rpc.call(method, params);
        assertCode(RPC_UNAVAILABLE, () -> new EvmTransactionClient(1, missingBlock).listTransactions(WALLET, 20, null));
        var failing = new EvmTransactionClient(1, (method, params) -> {
            throw new IllegalStateException("secret-rpc-key and sensitive response");
        });
        var error = assertThrows(IllegalStateException.class, () -> failing.getTransactionStatus(TX));
        assertEquals("secret-rpc-key and sensitive response", error.getMessage());
        assertCode(WRONG_CHAIN, () -> new EvmTransactionClient(2, rpc).getTransactionStatus(TX));
        var malformed = new EvmTransactionClient(1, (method, params) -> method.equals("eth_chainId") ? "0x1" : "bad");
        assertCode(INVALID_RESPONSE, () -> malformed.getTransaction(TX));
    }

    @Test
    void preservesInterruptAndValidatesInputsBeforeRpc() {
        var rpc = new Fixture();
        assertThrows(IllegalArgumentException.class, () -> rpc.client().getTransaction("privy-tx-id"));
        assertThrows(IllegalArgumentException.class, () -> rpc.client().listTransactions("wallet-id", 20, null));
        assertThrows(IllegalArgumentException.class, () -> new EvmTransactionQuery(-1, null, 20));
        assertThrows(IllegalArgumentException.class, () -> new EvmTransactionQuery(10, 9L, 20));
        assertThrows(IllegalArgumentException.class, () -> new EvmTransactionQuery(0, null, 101));
        assertTrue(rpc.methods.isEmpty());
        var interrupted = new EvmTransactionClient(1, (method, params) -> {
            throw new RuntimeException(new InterruptedException());
        });
        try {
            var error = assertThrows(RuntimeException.class, () -> interrupted.getTransaction(TX));
            assertInstanceOf(InterruptedException.class, error.getCause());
            assertTrue(Thread.currentThread().isInterrupted());
        } finally { Thread.interrupted(); }
    }

    @Test
    void realHttpTransportSupportsAllThreeReadApisAndSurfacesRpcErrors() throws Exception {
        var rpc = new Fixture();
        rpc.add(10, 0, WALLET, OTHER, "0x1");
        var error = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            var request = Json.object(exchange.getRequestBody().readAllBytes());
            @SuppressWarnings("unchecked") var params = (List<Object>) request.get("params");
            var response = new LinkedHashMap<String, Object>();
            response.put("jsonrpc", "2.0");
            response.put("id", request.get("id"));
            if (error.get() == null) response.put("result", rpc.call((String) request.get("method"), params));
            else response.put("error", Map.of("code", -32000, "message", error.get()));
            byte[] body = Json.bytes(response);
            exchange.sendResponseHeaders(200, body.length);
            try (var out = exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        try {
            var client = new EvmTransactionClient(1, URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            assertEquals(TX, client.getTransaction(TX).orElseThrow().hash());
            assertEquals(SUCCEEDED, client.getTransactionStatus(TX).state());
            assertEquals(1, client.listTransactions(WALLET, new EvmTransactionQuery(10, 10L, 20)).transactions().size());
            assertTrue(client.getTransaction(hash(999)).isEmpty());
            assertTrue(rpc.methods.stream().allMatch(m -> Set.of("eth_chainId", "eth_blockNumber",
                    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber").contains(m)));
            error.set("original provider failure");
            var failure = assertThrows(com.youngminkim.recanet.dmrvn.UpstreamException.class,
                    () -> client.getTransactionStatus(TX));
            assertEquals(-32000, failure.code());
            assertEquals("original provider failure", failure.getMessage());
        } finally { server.stop(0); }
    }

    private static void assertCode(TransactionQueryException.Code code, Runnable action) {
        assertEquals(code, assertThrows(TransactionQueryException.class, action::run).code());
    }

    private static String hash(long n) { return "0x" + String.format("%064x", n); }
    private static String blockHash(long n) { return hash(10000 + n); }
    private static String quantity(long n) { return "0x" + Long.toHexString(n); }

    private static final class Fixture implements EvmRpc {
        long head = 10;
        boolean changed;
        final Map<String, Map<String, Object>> transactions = new LinkedHashMap<>();
        final Map<String, Map<String, Object>> receipts = new LinkedHashMap<>();
        final Map<Long, List<Map<String, Object>>> blocks = new HashMap<>();
        final List<String> methods = new ArrayList<>();

        EvmTransactionClient client() { return new EvmTransactionClient(1, this); }

        Map<String, Object> add(long block, int index, String from, String to, String status) {
            String hash = hash(transactions.size() + 1);
            var tx = new LinkedHashMap<String, Object>();
            tx.put("hash", hash);
            tx.put("from", from);
            tx.put("to", to);
            tx.put("value", "0x123");
            tx.put("nonce", quantity(index));
            tx.put("input", "0x");
            tx.put("gas", "0x5208");
            tx.put("gasPrice", "0x45");
            tx.put("blockNumber", quantity(block));
            tx.put("blockHash", blockHash(block));
            tx.put("transactionIndex", quantity(index));
            transactions.put(hash, tx);
            blocks.computeIfAbsent(block, ignored -> new ArrayList<>()).add(tx);
            var receipt = new LinkedHashMap<String, Object>(tx);
            receipt.put("transactionHash", hash);
            receipt.put("status", status);
            receipt.put("gasUsed", "0x5208");
            receipt.put("effectiveGasPrice", "0x45");
            receipt.put("logs", List.of());
            receipts.put(hash, receipt);
            return tx;
        }

        public Object call(String method, List<Object> params) {
            methods.add(method);
            return switch (method) {
                case "eth_chainId" -> "0x1";
                case "eth_blockNumber" -> quantity(head);
                case "eth_getTransactionByHash" -> transactions.get(params.get(0));
                case "eth_getTransactionReceipt" -> receipts.get(params.get(0));
                case "eth_getBlockByNumber" -> {
                    long n = Long.parseLong(((String) params.get(0)).substring(2), 16);
                    var entries = blocks.getOrDefault(n, List.of());
                    yield Map.of("number", quantity(n), "hash", changed ? hash(999) : blockHash(n),
                            "parentHash", blockHash(n - 1), "transactions", Boolean.TRUE.equals(params.get(1))
                                    ? entries : entries.stream().map(t -> t.get("hash")).toList());
                }
                default -> throw new AssertionError("Unexpected RPC: " + method);
            };
        }
    }
}
