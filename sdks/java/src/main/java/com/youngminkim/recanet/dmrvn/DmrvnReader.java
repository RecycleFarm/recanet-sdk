package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

/**
 * Independent on-chain/Greenfield result reader. No Privy credentials or Firebase access required.
 */
public final class DmrvnReader {
    @FunctionalInterface
    public interface ReportReader {
        byte[] read(Map<String, Object> location);
    }

    @FunctionalInterface
    public interface ReportResolver {
        Map<String, Object> resolve(String reportHash);
    }

    private final DmrvnConfig config;
    private final Chain chain;
    private final ReportReader reader;
    private final ReportResolver resolver;

    public DmrvnReader(
            DmrvnConfig config, EvmRpc rpc, ReportReader reader, ReportResolver resolver) {
        this.config = config;
        chain = new Chain(config, rpc);
        this.reader = Objects.requireNonNull(reader);
        this.resolver = Objects.requireNonNull(resolver);
    }

    public static ReportResolver defaultReportResolver(String chainId, String bucket) {
        return hash ->
                Json.obj(
                        "storageType",
                        1,
                        "chainId",
                        chainId,
                        "bucketName",
                        bucket,
                        "objectName",
                        "dmrvn/v4/reports/" + Crypto.bytes32(hash).substring(2) + ".json");
    }

    /** A report failure is returned separately while preserving the observed chain status. */
    public Map<String, Object> readResult(
            String claimId,
            Long fromBlock,
            String reportTxHash,
            boolean waitTimedOut,
            String expectedFileHash) {
        claimId = Crypto.bytes32(claimId);
        long head = chain.confirmedHead();
        var verified = chain.verifyDeployment(head);
        var claim = chain.claim(claimId, head);
        int status = Crypto.uint(claim.get("status"), 8).intValueExact();
        require(status <= 4, Code.RPC_UNAVAILABLE);
        var result =
                Json.obj(
                        "claimId",
                        claimId,
                        "chainId",
                        config.chainId(),
                        "claimAddress",
                        config.claimAddress(),
                        "deploymentId",
                        config.deploymentId(),
                        "verifiedMetadata",
                        verified,
                        "observedBlock",
                        head,
                        "chainStatus",
                        List.of("NONE", "PENDING", "VALID", "INVALID", "REVOKED").get(status),
                        "taskStatus",
                        "UNKNOWN",
                        "claim",
                        claim,
                        "reportVerified",
                        false,
                        "observationStatus",
                        status == 1
                                ? (waitTimedOut ? "LOCAL_WAIT_TIMEOUT" : "WAITING")
                                : "NOT_FINALIZED");
        if (status != 2 && status != 3) return result;
        result.put("observationStatus", "FINALIZED");
        try {
            if (reportTxHash == null) {
                require(fromBlock != null, Code.REPORT_LOOKUP_RANGE);
                reportTxHash =
                        chain.findTransaction(
                                "MrvClaimReported",
                                claimId,
                                fromBlock,
                                head,
                                "reportHash",
                                Json.str(claim.get("reportHash")));
            }
            require(reportTxHash != null, Code.REPORT_TX_NOT_FOUND);
            Crypto.bytes32(reportTxHash);
            var receipt = chain.receipt(reportTxHash, head);
            Object txObject = chain.call("eth_getTransactionByHash", reportTxHash);
            require(receipt != null && txObject != null, Code.REPORT_TX_NOT_FOUND);
            require(Chain.number(receipt.get("status")).intValueExact() == 1, Code.REPORT_MISMATCH);
            var tx = Json.map(txObject);
            require(
                    reportTxHash.equalsIgnoreCase(Json.str(tx.get("hash")))
                            && Objects.equals(tx.get("blockHash"), receipt.get("blockHash")),
                    Code.REPORT_MISMATCH);
            var event = chain.event("MrvClaimReported", receipt, claimId);
            var pointer = resolver.resolve(Json.str(claim.get("reportHash")));
            byte[] bytes;
            try {
                bytes = reader.read(Json.copy(pointer));
                require(bytes != null && bytes.length <= 4 * 1024 * 1024, Code.REPORT_READ_FAILED);
            } catch (Exception e) {
                throw new DmrvnException(Code.REPORT_READ_FAILED);
            }
            result.putAll(
                    ReportVerifier.verify(
                            config, claimId, claim, event, tx, bytes, expectedFileHash));
            result.put("reportTxHash", reportTxHash);
            result.put("reportPointer", pointer);
            result.put("receipt", receipt);
        } catch (DmrvnException e) {
            result.put(
                    "reportError",
                    Json.obj(
                            "code",
                            e.code().name(),
                            "retryable",
                            e.retryable(),
                            "action",
                            "READ_ONLY"));
        } catch (RuntimeException e) {
            result.put(
                    "reportError",
                    Json.obj("code", "REPORT_MISMATCH", "retryable", false, "action", "READ_ONLY"));
        }
        return result;
    }

    /** Independently verifies supplied private Evidence bytes against this deployment's Claim. */
    public String verifyEvidenceProvenance(String claimId, byte[] evidenceBytes) {
        long head = chain.confirmedHead();
        chain.verifyDeployment(head);
        var claim = chain.claim(Crypto.bytes32(claimId), head);
        require(!"0".equals(String.valueOf(claim.get("status"))), Code.OPERATION_NOT_PREPARED);
        require(evidenceBytes != null && evidenceBytes.length <= 1024 * 1024, Code.INVALID_INPUT);
        return DmrvnProtocol.verifyProvenance(
                Json.object(evidenceBytes),
                Json.str(claim.get("evidenceHash")),
                Json.str(claim.get("approver")));
    }
}
