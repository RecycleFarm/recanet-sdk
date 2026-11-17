package com.youngminkim.recanet;

import static com.youngminkim.recanet.TransactionData.*;
import static com.youngminkim.recanet.TransactionQueryException.Code.*;

import com.youngminkim.recanet.dmrvn.DmrvnException;
import com.youngminkim.recanet.dmrvn.EvmRpc;
import com.youngminkim.recanet.dmrvn.HttpEvmRpc;

import java.math.BigInteger;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Read-only EVM transaction queries using a chain RPC. No Privy credentials or wallet keys are
 * needed. Wallet history includes top-level transactions whose from address matches the wallet,
 * including reverted calls and contract creation. It excludes incoming transfers, internal calls,
 * unmined transactions and user operations sent by another account (such as a Relay).
 */
public final class EvmTransactionClient {
    /** Maximum full blocks fetched by a single wallet history request. */
    public static final int MAX_BLOCKS_PER_PAGE = 100;
    private final long chainId;
    private final EvmRpc rpc;

    public EvmTransactionClient(long chainId, URI rpcUrl) {
        this(chainId, new HttpEvmRpc(rpcUrl));
    }

    /** Allows applications to supply their existing RPC transport. */
    public EvmTransactionClient(long chainId, EvmRpc rpc) {
        if (chainId <= 0) throw new IllegalArgumentException("chainId must be positive");
        this.chainId = chainId;
        this.rpc = Objects.requireNonNull(rpc, "rpc");
    }

    /** Returns empty only when the RPC returns null for this hash. RPC errors are thrown. */
    public Optional<EvmTransaction> getTransaction(String txHash) {
        String hash = argumentHex(txHash, 32, "txHash");
        verifyChain();
        Object raw = call("eth_getTransactionByHash", hash);
        if (raw == null) return Optional.empty();
        var tx = map(raw);
        require(hash.equals(hex(tx.get("hash"), 32)));
        if (tx.get("blockNumber") == null) return Optional.of(detail(tx, null, 0));

        long number = height(tx.get("blockNumber"));
        Object receipt = call("eth_getTransactionReceipt", hash);
        long head = height(call("eth_blockNumber"));
        var block = block(number, false);
        sameChain(hex(tx.get("blockHash"), 32).equals(hex(block.get("hash"), 32)));
        return Optional.of(detail(tx, receipt, head));
    }

    /** Reads the current transaction state without submitting or retrying a transaction. */
    public EvmTransactionStatus getTransactionStatus(String txHash) {
        String hash = argumentHex(txHash, 32, "txHash");
        return getTransaction(hash).map(EvmTransaction::status).orElseGet(() ->
                new EvmTransactionStatus(chainId, hash, EvmTransactionStatus.State.NOT_FOUND, null, 0));
    }

    /** Starts at the latest block and pages backwards to genesis. Prefer a bounded range. */
    public EvmTransactionPage listTransactions(String walletAddress, int limit, String cursor) {
        return listTransactions(walletAddress, new EvmTransactionQuery(0, null, limit, cursor));
    }

    /**
     * Reads one page of outgoing wallet transactions, newest first. Each page scans at most 100
     * blocks, so even an empty page may have a cursor. Cursors bind the chain, wallet, range and
     * initial block snapshot. A reorganization causes CHAIN_CHANGED instead of silent omissions.
     */
    public EvmTransactionPage listTransactions(String walletAddress, EvmTransactionQuery query) {
        String address = argumentHex(walletAddress, 20, "walletAddress");
        Objects.requireNonNull(query, "query");
        Cursor cursor = query.cursor() == null ? null : decode(query.cursor(), address, query);
        verifyChain();
        long head = height(call("eth_blockNumber"));
        if (cursor == null) {
            long upper = query.toBlock() == null ? head : query.toBlock();
            if (upper > head || query.fromBlock() > upper)
                throw new IllegalArgumentException("Transaction block range exceeds the current chain head");
            String anchor = hex(block(upper, false).get("hash"), 32);
            cursor = new Cursor(upper, anchor, upper, -1, anchor);
        }
        sameChain(head >= cursor.snapshot());
        verifyAnchor(cursor);

        var transactions = new ArrayList<EvmTransaction>();
        int scanned = 0;
        long number = cursor.nextBlock();
        int nextIndex = cursor.nextIndex();
        String expectedHash = cursor.expectedHash();
        Cursor next = null;
        while (number >= query.fromBlock() && scanned < MAX_BLOCKS_PER_PAGE) {
            var block = block(number, true);
            sameChain(expectedHash.equals(hex(block.get("hash"), 32)));
            String parent = hex(block.get("parentHash"), 32);
            var entries = list(block.get("transactions"));
            require(nextIndex == -1 || nextIndex < entries.size());
            int start = nextIndex == -1 ? entries.size() - 1 : nextIndex;
            scanned++;
            for (int i = start; i >= 0; i--) {
                var tx = map(entries.get(i));
                require(height(tx.get("blockNumber")) == number
                        && index(tx.get("transactionIndex")) == i
                        && expectedHash.equals(hex(tx.get("blockHash"), 32)));
                if (!address.equals(hex(tx.get("from"), 20))) continue;
                String hash = hex(tx.get("hash"), 32);
                transactions.add(detail(tx, call("eth_getTransactionReceipt", hash), head));
                if (transactions.size() == query.limit()) {
                    if (i > 0) {
                        next = new Cursor(cursor.snapshot(), cursor.anchorHash(), number, i - 1, expectedHash);
                    } else if (number > query.fromBlock()) {
                        next = new Cursor(cursor.snapshot(), cursor.anchorHash(), number - 1, -1, parent);
                    }
                    verifyAnchor(cursor);
                    return page(transactions, next, address, query, cursor.snapshot(), scanned);
                }
            }
            number--;
            nextIndex = -1;
            expectedHash = parent;
        }
        if (number >= query.fromBlock())
            next = new Cursor(cursor.snapshot(), cursor.anchorHash(), number, -1, expectedHash);
        verifyAnchor(cursor);
        return page(transactions, next, address, query, cursor.snapshot(), scanned);
    }

    private EvmTransaction detail(Map<String, Object> tx, Object rawReceipt, long head) {
        String hash = hex(tx.get("hash"), 32);
        String from = hex(tx.get("from"), 20);
        String to = tx.get("to") == null ? null : hex(tx.get("to"), 20);
        if (tx.get("chainId") != null)
            require(quantity(tx.get("chainId")).equals(BigInteger.valueOf(chainId)));
        Long number = tx.get("blockNumber") == null ? null : height(tx.get("blockNumber"));
        String blockHash = tx.get("blockHash") == null ? null : hex(tx.get("blockHash"), 32);
        Integer txIndex = tx.get("transactionIndex") == null ? null : index(tx.get("transactionIndex"));
        require((number == null && blockHash == null && txIndex == null)
                || (number != null && blockHash != null && txIndex != null));
        long confirmations = 0;
        var state = EvmTransactionStatus.State.PENDING;
        Map<String, Object> receipt = null;
        if (number != null) {
            sameChain(head >= number);
            require(head - number < Long.MAX_VALUE);
            confirmations = head - number + 1;
            state = EvmTransactionStatus.State.MINED;
            if (rawReceipt != null) {
                receipt = map(rawReceipt);
                require(hash.equals(hex(receipt.get("transactionHash"), 32)));
                sameChain(blockHash.equals(hex(receipt.get("blockHash"), 32))
                        && number == height(receipt.get("blockNumber")));
                require(txIndex == index(receipt.get("transactionIndex"))
                        && from.equals(hex(receipt.get("from"), 20))
                        && Objects.equals(to, receipt.get("to") == null ? null : hex(receipt.get("to"), 20)));
                if (receipt.get("status") != null) {
                    var executionStatus = quantity(receipt.get("status"));
                    require(executionStatus.equals(BigInteger.ZERO) || executionStatus.equals(BigInteger.ONE));
                    state = executionStatus.equals(BigInteger.ONE)
                            ? EvmTransactionStatus.State.SUCCEEDED : EvmTransactionStatus.State.REVERTED;
                }
            }
        }
        return new EvmTransaction(chainId, hash, from, to, quantity(tx.get("value")), quantity(tx.get("nonce")),
                input(tx.get("input")), quantity(tx.get("gas")), optionalQuantity(tx.get("gasPrice")),
                optionalQuantity(tx.get("maxFeePerGas")), optionalQuantity(tx.get("maxPriorityFeePerGas")),
                number, blockHash, txIndex,
                new EvmTransactionStatus(chainId, hash, state, number, confirmations), tx, receipt);
    }

    private Map<String, Object> block(long number, boolean fullTransactions) {
        Object raw = call("eth_getBlockByNumber", "0x" + Long.toHexString(number), fullTransactions);
        // An unavailable historical block must not silently look like an empty history page.
        if (raw == null) throw new TransactionQueryException(RPC_UNAVAILABLE);
        var block = map(raw);
        require(height(block.get("number")) == number);
        return block;
    }

    private void verifyChain() {
        if (!quantity(call("eth_chainId")).equals(BigInteger.valueOf(chainId)))
            throw new TransactionQueryException(WRONG_CHAIN);
    }

    private void verifyAnchor(Cursor cursor) {
        sameChain(cursor.anchorHash().equals(hex(block(cursor.snapshot(), false).get("hash"), 32)));
    }

    private Object call(String method, Object... params) {
        if (Thread.currentThread().isInterrupted()) throw new TransactionQueryException(INTERRUPTED);
        try {
            return rpc.call(method, List.of(params));
        } catch (DmrvnException e) {
            throw new TransactionQueryException(e.code() == DmrvnException.Code.INTERRUPTED ? INTERRUPTED
                    : e.code() == DmrvnException.Code.INVALID_INPUT ? INVALID_RESPONSE : RPC_UNAVAILABLE);
        } catch (RuntimeException e) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                    throw new TransactionQueryException(INTERRUPTED);
                }
            }
            throw new TransactionQueryException(RPC_UNAVAILABLE);
        }
    }

    private static void sameChain(boolean condition) {
        if (!condition) throw new TransactionQueryException(CHAIN_CHANGED);
    }

    private static String argumentHex(String value, int bytes, String name) {
        if (value == null || !value.matches("0x[0-9a-fA-F]{" + bytes * 2 + "}"))
            throw new IllegalArgumentException(name + " must be a 0x-prefixed " + bytes + "-byte hex value");
        return value.toLowerCase(Locale.ROOT);
    }

    private record Cursor(long snapshot, String anchorHash, long nextBlock, int nextIndex, String expectedHash) {}

    private String prefix(String address, EvmTransactionQuery query) {
        return "1:" + chainId + ":" + address + ":" + query.fromBlock() + ":"
                + (query.toBlock() == null ? "latest" : query.toBlock()) + ":";
    }

    private EvmTransactionPage page(List<EvmTransaction> transactions, Cursor next, String address,
                                   EvmTransactionQuery query, long upper, int scanned) {
        String encoded = next == null ? null : Base64.getUrlEncoder().withoutPadding().encodeToString(
                (prefix(address, query) + next.snapshot() + ":" + next.anchorHash() + ":" + next.nextBlock()
                        + ":" + next.nextIndex() + ":" + next.expectedHash()).getBytes(StandardCharsets.US_ASCII));
        return new EvmTransactionPage(transactions, encoded, query.fromBlock(), upper, scanned);
    }

    private Cursor decode(String value, String address, EvmTransactionQuery query) {
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(value), StandardCharsets.US_ASCII);
            if (!decoded.startsWith(prefix(address, query))) throw new IllegalArgumentException();
            String[] parts = decoded.split(":", -1);
            if (parts.length != 10) throw new IllegalArgumentException();
            long snapshot = Long.parseLong(parts[5]);
            long nextBlock = Long.parseLong(parts[7]);
            int nextIndex = Integer.parseInt(parts[8]);
            if (snapshot < query.fromBlock() || nextBlock < query.fromBlock() || nextBlock > snapshot
                    || nextIndex < -1 || (query.toBlock() != null && query.toBlock() != snapshot))
                throw new IllegalArgumentException();
            return new Cursor(snapshot, argumentHex(parts[6], 32, "anchor"), nextBlock, nextIndex,
                    argumentHex(parts[9], 32, "block"));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid transaction cursor for this chain, wallet or range");
        }
    }
}
