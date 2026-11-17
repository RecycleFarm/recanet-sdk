package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;
import java.time.Duration;
import java.util.Map;

/** Partner values plus optional identifiers/path; null identifiers are generated per invocation. */
public record ActivityRequest(String userId, String sourceEventId, Map<String, Object> inputs,
                              String claimId, String objectName, String gas,
                              Duration confirmationTimeout, Duration pollInterval) {
    public ActivityRequest(String userId, String sourceEventId, Map<String, Object> inputs) {
        this(userId, sourceEventId, inputs, null, null, "900000",
                Duration.ofSeconds(60), Duration.ofSeconds(1));
    }

    public ActivityRequest {
        require(userId != null && !userId.isBlank()
                && sourceEventId != null && sourceEventId.matches("[A-Za-z0-9:_-]{1,128}"),
                Code.INVALID_INPUT);
        require(inputs != null, Code.INVALID_INPUT);
        inputs = Json.copy(inputs);
        if (claimId != null) claimId = Crypto.bytes32(claimId);
        var n = Crypto.uint(gas, 256);
        require(n.compareTo(java.math.BigInteger.valueOf(100000)) >= 0
                && n.compareTo(java.math.BigInteger.valueOf(2000000)) <= 0, Code.INVALID_INPUT);
        require(confirmationTimeout != null && !confirmationTimeout.isNegative()
                && confirmationTimeout.compareTo(Duration.ofMinutes(10)) <= 0
                && pollInterval != null && pollInterval.compareTo(Duration.ofMillis(1)) >= 0
                && pollInterval.compareTo(Duration.ofSeconds(10)) <= 0, Code.INVALID_INPUT);
    }

    @Override public Map<String, Object> inputs() { return Json.copy(inputs); }
}
