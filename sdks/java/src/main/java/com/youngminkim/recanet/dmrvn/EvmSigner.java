package com.youngminkim.recanet.dmrvn;

import java.util.Map;

/** Backend signer only; beneficiary signatures belong to the app wallet. */
public interface EvmSigner {
    String address();

    String signMessage(String message);

    String signTypedData(Map<String, Object> typedData);

    /** Sends exactly this transaction. Implementations must disable automatic retries. */
    String sendTransaction(long chainId, Map<String, Object> transaction, String idempotencyKey);
}
