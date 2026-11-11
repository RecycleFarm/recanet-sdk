package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;
import com.youngminkim.recanet.telemetry.SdkTelemetry;

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
    private final SdkTelemetry telemetry;

    public DmrvnReader(
            DmrvnConfig config, EvmRpc rpc, ReportReader reader, ReportResolver resolver) {
        this(config, rpc, reader, resolver, SdkTelemetry.local());
    }

    public DmrvnReader(
            DmrvnConfig config, EvmRpc rpc, ReportReader reader, ReportResolver resolver,
            SdkTelemetry telemetry) {
        this.config = config;
        this.telemetry = Objects.requireNonNull(telemetry, "telemetry");
        chain = new Chain(config, telemetry.instrumentRpc(rpc));
        Objects.requireNonNull(reader);
        Objects.requireNonNull(resolver);
        this.reader = location -> telemetry.step("ReportReader.read", () -> reader.read(location));
        this.resolver = hash -> telemetry.step("ReportResolver.resolve", () -> resolver.resolve(hash));
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

    /** SDK report validation failures are returned separately; external errors propagate unchanged. */
    public Map<String, Object> readResult(
            String claimId,
            Long fromBlock,
            String reportTxHash,
            boolean waitTimedOut,
            String expectedFileHash) {
        return telemetry.observe("DmrvnReader.readResult", null,
                () -> readResultImpl(claimId, fromBlock, reportTxHash, waitTimedOut, expectedFileHash));
    }

    private Map<String, Object> readResultImpl(
            String claimId,
            Long fromBlock,
            String reportTxHash,
            boolean waitTimedOut,
            String expectedFileHash) {
        claimId = Crypto.bytes32(claimId, "claimId");
        long head = chain.confirmedHead();
        var verified = chain.verifyDeployment(head);
        var claim = chain.claim(claimId, head);
        int status = Crypto.uint(claim.get("status"), 8, "status").intValueExact();
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
                                Json.str(claim.get("reportHash"), "reportHash"));
            }
            require(reportTxHash != null, Code.REPORT_TX_NOT_FOUND);
            Crypto.bytes32(reportTxHash, "reportTxHash");
            var receipt = chain.receipt(reportTxHash, head);
            Object txObject = chain.call("eth_getTransactionByHash", reportTxHash);
            require(receipt != null && txObject != null, Code.REPORT_TX_NOT_FOUND);
            require(Chain.number(receipt.get("status")).intValueExact() == 1, Code.REPORT_MISMATCH);
            var tx = Json.map(txObject);
            require(
                    reportTxHash.equalsIgnoreCase(Json.str(tx.get("hash"), "hash"))
                            && Objects.equals(tx.get("blockHash"), receipt.get("blockHash")),
                    Code.REPORT_MISMATCH);
            var event = chain.event("MrvClaimReported", receipt, claimId);
            var pointer = resolver.resolve(Json.str(claim.get("reportHash"), "reportHash"));
            byte[] bytes = reader.read(Json.copy(pointer));
            require(bytes != null && bytes.length <= 4 * 1024 * 1024, Code.REPORT_READ_FAILED);
            telemetry.checkpoint(SdkTelemetry.State.REPORT_READ);
            result.putAll(
                    ReportVerifier.verify(
                            config, claimId, claim, event, tx, bytes, expectedFileHash));
            telemetry.checkpoint(SdkTelemetry.State.REPORT_VERIFIED);
            result.put("reportTxHash", reportTxHash);
            result.put("reportPointer", pointer);
            result.put("receipt", receipt);
        } catch (UpstreamException e) {
            throw e;
        } catch (DmrvnException e) {
            telemetry.recordHandledFailure(e);
            result.put(
                    "reportError",
                    Json.obj(
                            "code",
                            e.code().name(),
                            "message",
                            e.getMessage(),
                            "retryable",
                            e.retryable(),
                            "action",
                            "READ_ONLY"));
        }
        return result;
    }

    /** Independently verifies supplied private Evidence bytes against this deployment's Claim. */
    public String verifyEvidenceProvenance(String claimId, byte[] evidenceBytes) {
        return telemetry.observe("DmrvnReader.verifyEvidenceProvenance", null,
                () -> verifyEvidenceProvenanceImpl(claimId, evidenceBytes));
    }

    private String verifyEvidenceProvenanceImpl(String claimId, byte[] evidenceBytes) {
        long head = chain.confirmedHead();
        chain.verifyDeployment(head);
        var claim = chain.claim(Crypto.bytes32(claimId, "claimId"), head);
        require(!"0".equals(String.valueOf(claim.get("status"))), Code.OPERATION_NOT_PREPARED);
        require(evidenceBytes != null && evidenceBytes.length <= 1024 * 1024, Code.INVALID_INPUT,
                "evidenceBytes", "must not be null and must not exceed 1048576 bytes");
        return DmrvnProtocol.verifyProvenance(
                Json.object(evidenceBytes),
                Json.str(claim.get("evidenceHash"), "evidenceHash"),
                Json.str(claim.get("approver"), "approver"));
    }
}
