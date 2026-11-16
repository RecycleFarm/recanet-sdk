package com.youngminkim.recanet;

import io.privy.api.models.errors.APIException;
import io.privy.api.models.operations.WalletListRequest;
import com.youngminkim.recanet.dmrvn.EvmSigner;
import com.youngminkim.recanet.dmrvn.BeneficiaryWallets;
import com.youngminkim.recanet.dmrvn.DmrvnException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Backend-controlled, per-member Ethereum wallets. No Privy user or user JWT is required.
 * The service must authenticate/authorize the member ID before calling this trusted backend API.
 * Use a stable namespace per service/tenant; changing it selects a different set of wallets.
 * Authorization keys must be persisted securely before provisioning wallets.
 */
public final class UserWalletClient {
    private final PrivyClient client;
    private final BackendWalletRegistration registration;
    private final String namespace;
    private final Long partnerId;

    public UserWalletClient(PrivyClient client, BackendWalletRegistration registration, String namespace) {
        this(client, registration, namespace, null);
    }

    private UserWalletClient(PrivyClient client, BackendWalletRegistration registration,
                             String namespace, Long partnerId) {
        this.client = Objects.requireNonNull(client, "client");
        this.registration = Objects.requireNonNull(registration, "registration");
        if (namespace == null || !namespace.matches("[a-zA-Z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("namespace must contain 1-64 URL-safe characters");
        }
        this.namespace = namespace;
        this.partnerId = partnerId;
    }

    /** Checks authenticated partner credentials, tenant scope, member consent and revocation. */
    @FunctionalInterface
    public interface WalletAuthorization {
        boolean isAuthorized(long partnerId, String userId);
    }

    /**
     * Opt-in DMRVN mapping: namespace + partner ID + member ID. Existing unscoped wallets are not
     * silently adopted. The application supplies its verified credential/consent policy; this is
     * an adapter choice, not a finalized Privy mapping required by the shared specification.
     */
    public BeneficiaryWallets forPartner(long partnerId, WalletAuthorization authorization) {
        if (partnerId <= 0 || partnerId > 0xffffffffL)
            throw new IllegalArgumentException("partnerId must be uint32 and positive");
        Objects.requireNonNull(authorization, "authorization");
        var scoped = new UserWalletClient(client, registration, namespace, partnerId);
        var telemetry = client.config().telemetry();
        return (requestedPartner, userId) -> telemetry.observe("BeneficiaryWallets.getOrCreateSigner", null, () -> {
            requireText(userId, "userId");
            Runnable authorize = () -> telemetry.step("PartnerWallet.authorize", () -> {
                if (requestedPartner != partnerId || !authorization.isAuthorized(partnerId, userId))
                    throw new DmrvnException(DmrvnException.Code.UNAUTHORIZED_SIGNER);
                return null;
            });
            authorize.run();
            scoped.getOrCreateWallet(userId);
            var delegate = scoped.signerFor(userId);
            return new EvmSigner() {
                @Override public String address() { return delegate.address(); }
                @Override public String signMessage(String message) {
                    return telemetry.observe("PartnerWallet.signMessage", null, () -> {
                        authorize.run();
                        return delegate.signMessage(message);
                    });
                }
                @Override public String signTypedData(Map<String, Object> data) {
                    return telemetry.observe("PartnerWallet.signTypedData", null, () -> {
                        authorize.run();
                        return delegate.signTypedData(data);
                    });
                }
                @Override public String sendTransaction(long chainId, Map<String, Object> tx, String key) {
                    return telemetry.observe("PartnerWallet.sendTransaction", key, () -> {
                        authorize.run();
                        return delegate.sendTransaction(chainId, tx, key);
                    });
                }
            };
        });
    }

    /**
     * Returns the member's wallet or creates one with the backend key as owner.
     * A deterministic, app-unique Privy external ID prevents duplicate provisioning,
     * including concurrent calls. On an ambiguous network failure, call again with the
     * same namespace/member ID to discover the wallet; creation is never blindly retried.
     * Lookup precedes creation. A failed lookup or create, including HTTP 409, is propagated
     * immediately without a recovery lookup.
     */
    public UserWallet getOrCreateWallet(String userId) {
        return client.config().telemetry().observe("UserWalletClient.getOrCreateWallet", null,
                () -> getOrCreateWalletImpl(userId));
    }

    private UserWallet getOrCreateWalletImpl(String userId) {
        String externalId = externalId(userId);
        var existing = findWallet(userId);
        if (existing.isPresent()) return existing.get();
        var wallet = client.registerBackendWallet(registration,
                new BackendWalletCreateRequest("ethereum", null, externalId));
        if (!"ethereum".equals(wallet.chainType())) throw invalidResponse();
        return new UserWallet(userId, wallet.id(), wallet.address(), wallet.chainType());
    }

    /** Finds only wallets associated with both this member and this backend authorization key. */
    public Optional<UserWallet> findWallet(String userId) {
        return client.config().telemetry().observe("UserWalletClient.findWallet", null,
                () -> findWalletImpl(userId));
    }

    private Optional<UserWallet> findWalletImpl(String userId) {
        String externalId = externalId(userId);
        String cursor = null;
        UserWallet found = null;
        var cursors = new HashSet<String>();
        try {
            do {
                var request = WalletListRequest.builder()
                        .externalId(externalId)
                        .authorizationKey(registration.publicKey())
                        .includeArchived(false)
                        .limit(100.0);
                if (cursor != null) request.cursor(cursor);
                var response = client.sdk().wallets().list(request.build());
                var page = response.object().orElseThrow(UserWalletClient::invalidResponse);
                for (var wallet : page.data()) {
                    if (!externalId.equals(wallet.externalId().orElse(null))
                            || !"ethereum".equals(wallet.chainType().value()) || found != null) {
                        throw invalidResponse();
                    }
                    found = new UserWallet(userId, wallet.id(), wallet.address(), wallet.chainType().value());
                }
                String next = page.nextCursor().orElse(null);
                if (next != null && !next.isBlank() && !cursors.add(next)) throw invalidResponse();
                cursor = next;
            } while (cursor != null && !cursor.isBlank());
            client.config().telemetry().checkpoint(found == null
                    ? com.youngminkim.recanet.telemetry.SdkTelemetry.State.WALLET_NOT_FOUND
                    : com.youngminkim.recanet.telemetry.SdkTelemetry.State.WALLET_FOUND);
            return Optional.ofNullable(found);
        } catch (APIException e) {
            throw e;
        } catch (PrivyApiException e) {
            throw e;
        }
    }

    /** Signs a personal_sign message with the member's wallet using the backend key. */
    public String signMessage(String userId, String message) {
        return client.config().telemetry().observe("UserWalletClient.signMessage", null,
                () -> signMessageImpl(userId, message));
    }

    private String signMessageImpl(String userId, String message) {
        Objects.requireNonNull(message, "message");
        return signer(userId).signMessage(message);
    }

    /** Signs EIP-712 data with the member's wallet using the backend key. */
    public String signTypedData(String userId, Map<String, Object> typedData) {
        return client.config().telemetry().observe("UserWalletClient.signTypedData", null,
                () -> signTypedDataImpl(userId, typedData));
    }

    private String signTypedDataImpl(String userId, Map<String, Object> typedData) {
        Objects.requireNonNull(typedData, "typedData");
        return signer(userId).signTypedData(typedData);
    }

    /**
     * Sends a fully populated transaction without automatic retries. The transaction uses
     * hex quantity strings for value, gas, gasPrice and nonce, plus to and data.
     * Persist the exact request and idempotency key together for recovery; do not rebuild
     * a different transaction under the same key. A hash means submitted, not confirmed.
     */
    public String sendTransaction(String userId, long chainId, Map<String, Object> transaction,
                                  String idempotencyKey) {
        return client.config().telemetry().observe("UserWalletClient.sendTransaction", idempotencyKey,
                () -> sendTransactionImpl(userId, chainId, transaction, idempotencyKey));
    }

    private String sendTransactionImpl(String userId, long chainId, Map<String, Object> transaction,
                                  String idempotencyKey) {
        if (chainId <= 0) throw new IllegalArgumentException("chainId must be positive");
        Objects.requireNonNull(transaction, "transaction");
        requireText(idempotencyKey, "idempotencyKey");
        return signer(userId).sendTransaction(chainId, transaction, idempotencyKey);
    }

    /**
     * Resolves a member's backend-controlled signer for composed SDK workflows such as DMRVN.
     * The service must authenticate and authorize userId before calling this method.
     * Does not create a wallet or export its private key.
     */
    public EvmSigner signerFor(String userId) {
        return client.config().telemetry().observe("UserWalletClient.signerFor", null,
                () -> signerForImpl(userId));
    }

    private EvmSigner signerForImpl(String userId) {
        return signer(userId);
    }

    private PrivyEvmSigner signer(String userId) {
        var wallet = findWallet(userId).orElseThrow(
                () -> new IllegalStateException("No backend-controlled wallet exists for this member"));
        // Reuse the established key-ownership verification and official request signing.
        return new PrivyEvmSigner(client, wallet.id(), registration);
    }

    private String externalId(String userId) {
        requireText(userId, "userId");
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    (namespace + "\0" + (partnerId == null ? "" : partnerId + "\0") + userId)
                            .getBytes(StandardCharsets.UTF_8));
            // Separate external-ID domains also prevent crafted legacy member IDs from selecting
            // partner wallets through the unscoped compatibility API.
            return (partnerId == null ? "user_" : "partner_")
                    + Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " must not be blank");
    }

    private static PrivyApiException invalidResponse() {
        return new PrivyApiException(PrivyApiException.Code.INVALID_RESPONSE, 0, null);
    }
}
