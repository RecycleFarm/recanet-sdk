package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;
import java.time.Duration;
import java.util.Map;

/**
 * Partner values plus optional identifiers/path; null identifiers are generated per invocation.
 * confirmationTimeout and pollInterval are retained for source compatibility and validated,
 * but no longer schedule confirmation waiting or polling.
 */
public record ActivityRequest(String userId, String sourceEventId, Map<String, Object> inputs,
                              String claimId, String objectName, String gas,
                              Duration confirmationTimeout, Duration pollInterval) {
    public ActivityRequest(String userId, String sourceEventId, Map<String, Object> inputs) {
        this(userId, sourceEventId, inputs, null, null, "900000",
                Duration.ofSeconds(60), Duration.ofSeconds(1));
    }

    public ActivityRequest {
        require(userId != null && !userId.isBlank(), Code.INVALID_INPUT,
                "userId", "must not be null or blank");
        require(sourceEventId != null && sourceEventId.matches("[A-Za-z0-9:_-]{1,128}"),
                Code.INVALID_INPUT, "sourceEventId", "must contain 1 to 128 letters, digits, colons, underscores or hyphens");
        require(inputs != null, Code.INVALID_INPUT, "inputs", "must not be null");
        inputs = Json.copy(inputs, "inputs");
        if (claimId != null) claimId = Crypto.bytes32(claimId, "claimId");
        var n = Crypto.uint(gas, 256, "gas");
        require(n.compareTo(java.math.BigInteger.valueOf(100000)) >= 0
                && n.compareTo(java.math.BigInteger.valueOf(2000000)) <= 0, Code.INVALID_INPUT,
                "gas", "must be between 100000 and 2000000 inclusive");
        require(confirmationTimeout != null && !confirmationTimeout.isNegative()
                && confirmationTimeout.compareTo(Duration.ofMinutes(10)) <= 0, Code.INVALID_INPUT,
                "confirmationTimeout", "must be between 0 and 10 minutes inclusive");
        require(pollInterval != null && pollInterval.compareTo(Duration.ofMillis(1)) >= 0
                && pollInterval.compareTo(Duration.ofSeconds(10)) <= 0, Code.INVALID_INPUT,
                "pollInterval", "must be between 1 millisecond and 10 seconds inclusive");
    }

    @Override public Map<String, Object> inputs() { return Json.copy(inputs); }
}
