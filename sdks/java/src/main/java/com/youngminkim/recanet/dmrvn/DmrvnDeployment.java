package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.util.*;

/** An explicitly approved v7 manifest. Candidate releases are never treated as observed state. */
public final class DmrvnDeployment {
    private final Map<String, Object> metadata;

    private DmrvnDeployment(Map<String, Object> metadata) {
        this.metadata = Json.copy(metadata);
    }

    public static DmrvnDeployment fromManifest(Map<String, Object> input) {
        try {
            var m = Json.copy(input);
            long chain = Crypto.uint(m.get("chainId"), 53).longValueExact();
            require(chain > 0, Code.INVALID_INPUT);
            boolean normalized = m.containsKey("contractAddress");
            boolean proxy =
                    normalized ? "proxy".equals(m.get("deploymentKind")) : m.containsKey("proxy");
            if (normalized)
                require(proxy || "direct".equals(m.get("deploymentKind")), Code.INVALID_INPUT);
            else if (m.containsKey("deploymentKind"))
                require(
                        (proxy ? Set.of("proxy", "transparent-proxy") : Set.of("direct"))
                                .contains(Json.str(m.get("deploymentKind"))),
                        Code.INVALID_INPUT);
            var contract = normalized || proxy ? m : Json.map(m.get("contract"));
            var forwarder = normalized || proxy ? m : Json.map(m.get("forwarder"));
            require(
                    "7"
                            .equals(
                                    normalized
                                            ? m.get("protocolVersion")
                                            : contract.get("domainVersion")),
                    Code.INVALID_INPUT);
            require(
                    !m.containsKey("domainVersion") || "7".equals(m.get("domainVersion")),
                    Code.INVALID_INPUT);
            require(
                    !m.containsKey("forwarderDomainVersion")
                            || "1".equals(m.get("forwarderDomainVersion")),
                    Code.INVALID_INPUT);
            if (!normalized && !proxy)
                require("1".equals(forwarder.get("domainVersion")), Code.INVALID_INPUT);
            String target =
                    address(
                            normalized
                                    ? m.get("contractAddress")
                                    : proxy ? m.get("proxy") : contract.get("address"));
            String fwd =
                    address(
                            normalized
                                    ? m.get("forwarderAddress")
                                    : proxy ? m.get("forwarder") : forwarder.get("address"));
            var hashes =
                    normalized || proxy
                            ? Json.copy(Json.map(m.get("codeHashes")))
                            : Json.obj(
                                    "contract",
                                    contract.get("runtimeCodeHash"),
                                    "forwarder",
                                    forwarder.get("runtimeCodeHash"));
            for (String key :
                    proxy
                            ? List.of("proxy", "implementation", "forwarder", "proxyAdmin")
                            : List.of("contract", "forwarder"))
                hashes.put(key, hash(hashes.get(key)));
            var result =
                    Json.obj(
                            "chainId",
                            chain,
                            "contractAddress",
                            target,
                            "forwarderAddress",
                            fwd,
                            "protocolVersion",
                            "7",
                            "domainVersion",
                            "7",
                            "forwarderDomainVersion",
                            "1",
                            "deploymentKind",
                            proxy ? "proxy" : "direct",
                            "contractVersion",
                            null,
                            "contractVersionSupported",
                            proxy,
                            "codeHashes",
                            hashes);
            if (proxy) {
                String implementation =
                        address(m.get(normalized ? "implementationAddress" : "implementation"));
                String admin = address(m.get(normalized ? "proxyAdminAddress" : "proxyAdmin"));
                String implementationHash =
                        hash(
                                normalized
                                        ? m.get("approvedImplementationHash")
                                        : hashes.get("implementation"));
                require(
                        implementationHash.equals(hashes.get("implementation")),
                        Code.INVALID_INPUT);
                require(Set.of(target, fwd, implementation, admin).size() == 4, Code.INVALID_INPUT);
                var releases = new ArrayList<Object>();
                if (m.containsKey("approvedReleases"))
                    releases.addAll(Json.list(m.get("approvedReleases")));
                releases.add(
                        Json.obj(
                                "address",
                                implementation,
                                "codeHash",
                                implementationHash,
                                "contractVersion",
                                m.get("contractVersion")));
                var approved = new LinkedHashMap<String, Object>();
                for (Object raw : releases) {
                    var release = Json.map(raw);
                    String addr = address(release.get("address"));
                    String version = Json.str(release.get("contractVersion"));
                    require(Set.of("1.0.0", "1.0.1").contains(version), Code.INVALID_INPUT);
                    require(!List.of(target, fwd, admin).contains(addr), Code.INVALID_INPUT);
                    var value =
                            Json.obj(
                                    "address",
                                    addr,
                                    "codeHash",
                                    hash(release.get("codeHash")),
                                    "contractVersion",
                                    version);
                    require(
                            !approved.containsKey(addr) || approved.get(addr).equals(value),
                            Code.INVALID_INPUT);
                    approved.put(addr, value);
                }
                result.putAll(
                        Json.obj(
                                "implementationAddress",
                                implementation,
                                "proxyAdminAddress",
                                admin,
                                "owner",
                                address(m.get("owner")),
                                "approvedImplementationHash",
                                implementationHash,
                                "contractVersion",
                                m.get("contractVersion"),
                                "approvedReleases",
                                new ArrayList<>(approved.values())));
            } else {
                require(
                        m.get("contractVersion") == null && m.get("implementationAddress") == null,
                        Code.INVALID_INPUT);
            }
            if (m.containsKey("deployment"))
                result.put("deployment", Json.copy(Json.map(m.get("deployment"))));
            return new DmrvnDeployment(result);
        } catch (RuntimeException e) {
            throw new DmrvnException(Code.DEPLOYMENT_NOT_READY);
        }
    }

    public static DmrvnDeployment testnet() {
        return bundled("deployment-testnet.json");
    }

    /** Historical direct v7 is for recovery and reads only. */
    public static DmrvnDeployment historicalDirectTestnet() {
        return bundled("deployment-direct-v7-testnet.json");
    }

    private static DmrvnDeployment bundled(String name) {
        try (var stream = DmrvnDeployment.class.getResourceAsStream("/dmrvn/" + name)) {
            return fromManifest(Json.object(Objects.requireNonNull(stream).readAllBytes()));
        } catch (Exception e) {
            throw new DmrvnException(Code.DEPLOYMENT_NOT_READY);
        }
    }

    static String address(Object value) {
        String result = Crypto.address(Json.str(value));
        require(!result.equals("0x" + "00".repeat(20)), Code.INVALID_INPUT);
        return result;
    }

    private static String hash(Object value) {
        String result = Crypto.bytes32(Json.str(value));
        require(!result.equals(Crypto.ZERO), Code.INVALID_INPUT);
        return result;
    }

    public Map<String, Object> snapshot() {
        return Json.copy(metadata);
    }

    public long chainId() {
        return ((Number) metadata.get("chainId")).longValue();
    }

    public String contractAddress() {
        return Json.str(metadata.get("contractAddress"));
    }

    public String forwarderAddress() {
        return Json.str(metadata.get("forwarderAddress"));
    }

    public boolean isProxy() {
        return "proxy".equals(metadata.get("deploymentKind"));
    }

    public String runtimeCodeHash() {
        return Json.str(Json.map(metadata.get("codeHashes")).get(isProxy() ? "proxy" : "contract"));
    }

    void requireWritable() {
        require(isProxy(), Code.DEPLOYMENT_NOT_READY);
    }

    void assertCompatible(Map<String, Object> saved) {
        for (String field :
                List.of(
                        "chainId",
                        "contractAddress",
                        "forwarderAddress",
                        "protocolVersion",
                        "deploymentKind"))
            require(
                    String.valueOf(metadata.get(field)).equals(String.valueOf(saved.get(field))),
                    Code.DEPLOYMENT_COLLISION);
        if (isProxy()) {
            var release = release(Json.str(saved.get("implementationAddress")));
            require(
                    release != null
                            && release.get("codeHash")
                                    .equals(saved.get("approvedImplementationHash"))
                            && release.get("contractVersion").equals(saved.get("contractVersion")),
                    Code.UNAPPROVED_IMPLEMENTATION);
        }
    }

    Map<String, Object> release(String address) {
        if (!isProxy()) return null;
        return Json.list(metadata.get("approvedReleases")).stream()
                .map(Json::map)
                .filter(r -> r.get("address").equals(address))
                .findFirst()
                .map(Json::copy)
                .orElse(null);
    }
}
