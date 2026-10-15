package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

final class ReportVerifier {
    static void match(boolean condition) {
        require(condition, Code.REPORT_MISMATCH);
    }

    static void same(Object a, Object b) {
        match(Objects.equals(String.valueOf(a), String.valueOf(b)));
    }

    static Map<String, Object> verify(
            DmrvnConfig config,
            String claimId,
            Map<String, Object> stored,
            Map<String, Object> event,
            Map<String, Object> tx,
            byte[] bytes,
            String expectedFileHash) {
        try {
            return verifyInner(config, claimId, stored, event, tx, bytes, expectedFileHash);
        } catch (DmrvnException e) {
            throw new DmrvnException(Code.REPORT_MISMATCH);
        } catch (RuntimeException e) {
            throw new DmrvnException(Code.REPORT_MISMATCH);
        }
    }

    private static Map<String, Object> verifyInner(
            DmrvnConfig config,
            String claimId,
            Map<String, Object> stored,
            Map<String, Object> event,
            Map<String, Object> tx,
            byte[] bytes,
            String expectedFileHash) {
        match(event != null);
        match(config.claimAddress().equalsIgnoreCase(Json.str(tx.get("to"))));
        for (String key : List.of("status", "outputHash", "reportHash"))
            same(event.get(key), stored.get(key));
        var call = DmrvnProtocol.CLAIM.decodeCall("onReport", Json.str(tx.get("input")));
        var assignment = Json.map(call.get("assignment"));
        var observation = Json.map(call.get("observation"));
        var committee = Json.list(call.get("committee"));
        var domain = DmrvnProtocol.domain(config.chainId(), config.claimAddress(), false);
        same(assignment.get("claimId"), claimId);
        same(observation.get("claimId"), claimId);
        same(assignment.get("taskId"), observation.get("taskId"));
        same(event.get("taskId"), assignment.get("taskId"));
        same(event.get("committeeHash"), assignment.get("committeeHash"));
        int threshold = Crypto.uint(assignment.get("threshold"), 8).intValueExact();
        same(assignment.get("committeeSize"), committee.size());
        match(threshold > 0 && threshold <= committee.size());
        match(DmrvnProtocol.sortedAddresses(committee).equals(committee));
        same(DmrvnProtocol.committeeHash(assignment, committee), assignment.get("committeeHash"));
        for (String k : List.of("committeeHash", "quorumPolicyVersion", "deadline"))
            same(assignment.get(k), observation.get(k));
        for (String k :
                List.of(
                        "partnerId",
                        "activityId",
                        "methodologyId",
                        "methodologyVersion",
                        "evidenceHash",
                        "methodologyHash",
                        "evidenceLocationHash",
                        "outputHash")) same(stored.get(k), observation.get(k));
        same(
                DmrvnProtocol.evidenceLocationHash(Json.map(stored.get("evidenceLocation"))),
                stored.get("evidenceLocationHash"));
        same(observation.get("result"), stored.get("status"));
        String coordinator =
                Crypto.recover(
                        DmrvnProtocol.digest("TaskAssignment", domain, assignment),
                        Json.str(call.get("coordinatorSignature")));
        String digest = DmrvnProtocol.digest("MrvObservation", domain, observation);
        var signers =
                Json.list(call.get("observationSignatures")).stream()
                        .map(s -> Crypto.recover(digest, Json.str(s)))
                        .toList();
        match(
                signers.size() >= threshold
                        && signers.size() <= committee.size()
                        && new HashSet<>(signers).size() == signers.size()
                        && committee.containsAll(signers));
        same(
                DmrvnProtocol.reportHash(assignment, observation, signers, domain),
                stored.get("reportHash"));
        String fileHash = Crypto.hash(bytes);
        if (expectedFileHash != null) same(fileHash, Crypto.bytes32(expectedFileHash));
        var report = Json.object(bytes);
        for (String key : List.of("evidenceHash", "methodologyHash", "reportHash"))
            same(report.get(key), stored.get(key));
        same(report.get("claimId"), claimId);
        same(report.get("taskId"), assignment.get("taskId"));
        same(report.get("committeeHash"), assignment.get("committeeHash"));
        same(report.get("schemaVersion"), 1);
        same(report.get("result"), stored.get("status"));
        var outputs = Json.map(report.get("outputs"));
        if ("2".equals(String.valueOf(stored.get("status")))) {
            same(Json.hash(outputs), stored.get("outputHash"));
            match(!Crypto.ZERO.equals(stored.get("outputHash")));
        } else {
            match(outputs.isEmpty());
            same(Crypto.ZERO, stored.get("outputHash"));
        }
        for (Object raw : outputs.values()) {
            var output = Json.map(raw);
            match(output.keySet().equals(Set.of("value", "unit", "scale")));
            match(
                    Json.str(output.get("value")).matches("-?(0|[1-9][0-9]*)")
                            && !Json.str(output.get("unit")).isBlank());
            Crypto.uint(output.get("scale"), 32);
        }
        var source = Json.map(report.get("source"));
        same(
                Crypto.address(Json.str(source.get("approver"))),
                Crypto.address(Json.str(stored.get("approver"))));
        same(
                DmrvnProtocol.evidenceLocationHash(Json.map(source.get("evidenceLocation"))),
                stored.get("evidenceLocationHash"));
        same(source.get("evidenceLocationHash"), stored.get("evidenceLocationHash"));
        var entries = Json.list(report.get("observations"));
        match(entries.size() == signers.size());
        var reportSigners = new ArrayList<String>();
        for (Object raw : entries) {
            var entry = Json.map(raw);
            String d =
                    DmrvnProtocol.digest(
                            "MrvObservation", domain, Json.map(entry.get("observation")));
            same(d, digest);
            String recovered = Crypto.recover(d, Json.str(entry.get("signature")));
            same(recovered, Crypto.address(Json.str(entry.get("signer"))));
            reportSigners.add(recovered);
        }
        match(
                DmrvnProtocol.sortedAddresses(reportSigners)
                        .equals(DmrvnProtocol.sortedAddresses(signers)));
        return Json.obj(
                "reportVerified",
                true,
                "reportHash",
                stored.get("reportHash"),
                "outputHash",
                stored.get("outputHash"),
                "fileHash",
                fileHash,
                "fileHashVerification",
                expectedFileHash == null ? "DOWNLOAD_CHECKSUM_ONLY" : "MATCHED_EXTERNAL_COMMITMENT",
                "metadataIndependentlyVerified",
                false,
                "authorizationEvidence",
                "SUCCESSFUL_V7_RECEIPT",
                "coordinator",
                coordinator,
                "signers",
                signers,
                "outputs",
                outputs,
                "report",
                report);
    }
}
