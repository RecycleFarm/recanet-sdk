package com.youngminkim.recanet;

import java.math.BigInteger;
import java.util.Map;

/**
 * EVM transaction detail. Amounts are exact integers in wei. The recipient is null for contract
 * creation; block fields are null while pending. Fee fields can be absent depending on transaction
 * type. Raw transaction and receipt fields preserve logs and chain-specific fee data.
 */
public record EvmTransaction(
        long chainId, String hash, String from, String to, BigInteger valueWei, BigInteger nonce,
        String input, BigInteger gasLimit, BigInteger gasPriceWei, BigInteger maxFeePerGasWei,
        BigInteger maxPriorityFeePerGasWei, Long blockNumber, String blockHash,
        Integer transactionIndex, EvmTransactionStatus status,
        Map<String, Object> transaction, Map<String, Object> receipt) {
    public EvmTransaction {
        transaction = TransactionData.freezeMap(transaction);
        receipt = receipt == null ? null : TransactionData.freezeMap(receipt);
    }
}
