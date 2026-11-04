package com.youngminkim.recanet;

import io.privy.api.models.errors.APIException;
import io.privy.api.utils.RetryConfig;

import java.net.http.HttpClient;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Objects;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;
import io.privy.api.models.components.OwnerInput;
import io.privy.api.models.components.OwnerInputPublicKey;
import io.privy.api.models.components.Wallet;
import io.privy.api.models.components.WalletChainType;
import io.privy.api.AuthorizationContext;

/** Backend SDK facade backed by the official Privy Java SDK. */
public final class PrivyClient {
    private static final Logger LOGGER = Logger.getLogger(PrivyClient.class.getName());
    private final PrivyClientConfig config;
    private final io.privy.api.PrivyClient delegate;
    private final PrivyTokenVerifier tokenVerifier;

    /**
     * Initializes the official SDK without making an API request.
     * @param config server credentials and connection settings
     */
    public PrivyClient(PrivyClientConfig config) {
        this(config, HttpClient.newBuilder()
                .connectTimeout(Objects.requireNonNull(config, "config").requestTimeout())
                .build());
    }

    /**
     * Initializes the official SDK with an application-provided HTTP transport.
     * @param config server credentials and connection settings
     * @param httpClient transport to use for SDK requests
     */
    public PrivyClient(PrivyClientConfig config, HttpClient httpClient) {
        this.config = Objects.requireNonNull(config, "config");
        this.tokenVerifier = config.tokenVerification() == null ? null
                : new PrivyTokenVerifier(config.appId(), config.tokenVerification());
        this.delegate = io.privy.api.PrivyClient.builder()
                .appId(config.appId())
                .appSecret(config.appSecret())
                .serverUrl(config.baseUri().toString())
                .client(new PrivyHttpTransport(httpClient, config.requestTimeout()))
                .retryConfig(RetryConfig.noRetries())
                .build();
    }

    /** @return the configuration used to initialize this client */
    public PrivyClientConfig config() { return config; }

    /**
     * Checks app credentials through one read-only SDK request to list at most one user.
     * Call explicitly at startup or for diagnostics, not on every incoming request.
     * A forbidden response indicates missing permission, not invalid credentials.
     * @throws PrivyApiException if credentials, permissions, or the API request fail
     */
    public void verifyAppCredentials() {
        try {
            var response = delegate.users().list().limit(1.0).call();
            if (response.statusCode() != 200 || response.object().isEmpty()) {
                throw new PrivyApiException(PrivyApiException.Code.INVALID_RESPONSE, response.statusCode(), null);
            }
        } catch (APIException e) {
            PrivyApiException.Code code = switch (e.code()) {
                case 401 -> PrivyApiException.Code.INVALID_CREDENTIALS;
                case 403 -> PrivyApiException.Code.FORBIDDEN;
                case 429 -> PrivyApiException.Code.RATE_LIMITED;
                default -> e.code() >= 500 ? PrivyApiException.Code.UNAVAILABLE
                        : PrivyApiException.Code.INVALID_RESPONSE;
            };
            throw new PrivyApiException(code, e.code(), parseRetryAfter(e.rawResponse()));
        } catch (PrivyApiException e) {
            throw e;
        } catch (RuntimeException e) {
            for (Throwable cause = e; cause != null; cause = cause.getCause()) {
                if (cause instanceof InterruptedException) {
                    Thread.currentThread().interrupt();
                    throw new PrivyApiException(PrivyApiException.Code.INTERRUPTED, 0, null);
                }
            }
            throw new PrivyApiException(PrivyApiException.Code.UNAVAILABLE, 0, null);
        }
    }

    /**
     * Verifies an inbound user's Privy-issued access token using the configured public key source.
     * @param accessToken raw compact JWT
     * @return verified user and session claims
     * @throws PrivyAuthenticationException if verification fails
     * @throws IllegalStateException if token verification was not configured
     */
    public AuthenticatedUser verifyAccessToken(String accessToken) {
        return tokenVerifier().verifyAccessToken(accessToken);
    }

    /**
     * Authenticates one Bearer credential from an inbound HTTP request.
     * @param authorizationHeader value of the Authorization header
     * @return verified user and session claims
     * @throws PrivyAuthenticationException if verification fails
     * @throws IllegalStateException if token verification was not configured
     */
    public AuthenticatedUser authenticateAuthorizationHeader(String authorizationHeader) {
        return tokenVerifier().authenticateAuthorizationHeader(authorizationHeader);
    }

    /**
     * Creates a Privy wallet owned by the supplied backend public key.
     *
     * <p>The private key is deliberately not included in the Privy create request. It is
     * retained only by the caller for later authorization/signing operations.</p>
     *
     * @param registration backend public/private key pair; the private key is not transmitted
     * @param request wallet chain and optional metadata
     * @return the created wallet's non-secret metadata
     */
    public BackendWallet registerBackendWallet(BackendWalletRegistration registration,
                                               BackendWalletCreateRequest request) {
        Objects.requireNonNull(registration, "registration");
        Objects.requireNonNull(request, "request");
        final WalletChainType chainType;
        try {
            chainType = WalletChainType.fromValue(request.chainType())
                    .orElseThrow(() -> new IllegalArgumentException("Unsupported wallet chain type: " + request.chainType()));
        } catch (IllegalArgumentException e) {
            throw e;
        }

        var bodyBuilder = io.privy.api.models.operations.WalletCreateRequestBody.builder()
                .chainType(chainType)
                .owner(OwnerInput.of(new OwnerInputPublicKey(registration.publicKey())));
        if (request.displayName() != null) bodyBuilder.displayName(request.displayName());
        if (request.externalId() != null) bodyBuilder.externalId(request.externalId());

        try {
            var response = delegate.wallets().create(bodyBuilder.build());
            return response.wallet().map(PrivyClient::toBackendWallet)
                    .orElseThrow(() -> new PrivyApiException(
                            PrivyApiException.Code.INVALID_RESPONSE, response.statusCode(), null));
        } catch (APIException e) {
            throw apiFailure(e);
        }
    }

    /**
     * Retrieves a wallet and verifies that its registered public key matches the backend key.
     * This check does not transmit or expose the private key.
     */
    public boolean isBackendWallet(String walletId, BackendWalletRegistration registration) {
        Objects.requireNonNull(walletId, "walletId");
        Objects.requireNonNull(registration, "registration");
        if (walletId.isBlank()) throw new IllegalArgumentException("walletId must not be blank");
        try {
            var response = delegate.wallets().retrieve(walletId);
            return response.wallet().flatMap(Wallet::publicKey)
                    .map(registration.publicKey()::equals)
                    .orElse(false);
        } catch (APIException e) {
            throw apiFailure(e);
        }
    }

    /**
     * Lists wallets associated with a Privy authorization key.
     * The authorization key is sent as a query filter; the private key is never sent.
     * All server-side pages are consumed before returning.
     *
     * @param authorizationKey Privy authorization key identifier/public key
     * @return matching wallet metadata
     */
    public List<BackendWallet> listWalletsByAuthorizationKey(String authorizationKey) {
        if (authorizationKey == null || authorizationKey.isBlank()) {
            throw new IllegalArgumentException("authorizationKey must not be blank");
        }
        var wallets = new ArrayList<BackendWallet>();
        String cursor = null;
        do {
            var requestBuilder = io.privy.api.models.operations.WalletListRequest.builder()
                    .authorizationKey(authorizationKey)
                    .limit(100.0);
            if (cursor != null) requestBuilder.cursor(cursor);
            try {
                var response = delegate.wallets().list(requestBuilder.build());
                var page = response.object().orElseThrow(() -> new PrivyApiException(
                        PrivyApiException.Code.INVALID_RESPONSE, response.statusCode(), null));
                page.data().stream().map(PrivyClient::toBackendWallet).forEach(wallets::add);
                cursor = page.nextCursor().orElse(null);
            } catch (APIException e) {
                throw apiFailure(e);
            }
        } while (cursor != null && !cursor.isBlank());
        return List.copyOf(wallets);
    }

    /**
     * Ensures that a backend wallet exists using the configured environment variables.
     * If both backend key variables are present, an existing wallet is reused; otherwise
     * a new P-256 pair is generated and logged for one-time bootstrap.
     *
     * @param request wallet chain and optional metadata
     * @return an existing or newly created backend wallet
     */
    public BackendWallet ensureBackendWallet(BackendWalletCreateRequest request) {
        Objects.requireNonNull(request, "request");
        verifyAppCredentials();

        String publicKey = System.getenv("BACKEND_WALLET_PUBLIC_KEY");
        String privateKey = System.getenv("BACKEND_WALLET_PRIVATE_KEY");
        if (publicKey != null && !publicKey.isBlank()
                && privateKey != null && !privateKey.isBlank()) {
            var registration = new BackendWalletRegistration(publicKey, privateKey);
            var existing = listWalletsByAuthorizationKey(publicKey);
            if (!existing.isEmpty()) return existing.get(0);
            return registerBackendWallet(registration, request);
        }

        var generated = BackendWalletKeyPair.generateAndLog();
        return registerBackendWallet(generated.registration(), request);
    }

    /**
     * Exports the actual blockchain wallet private key after authorizing the request with the
     * backend authorization private key. Privy returns the export through an encrypted HPKE
     * response, which the official SDK decrypts in memory.
     *
     * <p>The returned value is highly sensitive. This method never logs it; callers must place
     * it directly into a secure vault or use it for the explicitly requested migration.</p>
     *
     * @param walletId Privy wallet ID
     * @param registration authorization key pair whose private key signs the export request
     * @return the exported blockchain wallet private key
     */
    public String exportWalletPrivateKey(String walletId, BackendWalletRegistration registration) {
        if (walletId == null || walletId.isBlank()) {
            throw new IllegalArgumentException("walletId must not be blank");
        }
        Objects.requireNonNull(registration, "registration");
        try {
            return delegate.wallets().export(walletId,
                    AuthorizationContext.withAuthorizationPrivateKey(registration.privyPrivateKey()));
        } catch (APIException e) {
            throw apiFailure(e);
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new PrivyApiException(
                    e instanceof InterruptedException ? PrivyApiException.Code.INTERRUPTED
                            : PrivyApiException.Code.UNAVAILABLE, 0, null);
        }
    }

    /**
     * Exports and logs the blockchain wallet private key for one-time partner bootstrap.
     * Do not call this in normal production code because log collectors may retain the key.
     */
    public String exportWalletPrivateKeyAndLog(String walletId, BackendWalletRegistration registration) {
        String walletPrivateKey = exportWalletPrivateKey(walletId, registration);
        LOGGER.log(Level.WARNING, "BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY={0}", walletPrivateKey);
        return walletPrivateKey;
    }

    private static BackendWallet toBackendWallet(Wallet wallet) {
        return new BackendWallet(wallet.id(), wallet.address(),
                wallet.publicKey().orElse(null), wallet.chainType().value());
    }

    static PrivyApiException apiFailure(APIException e) {
        PrivyApiException.Code code = switch (e.code()) {
            case 401 -> PrivyApiException.Code.INVALID_CREDENTIALS;
            case 403 -> PrivyApiException.Code.FORBIDDEN;
            case 429 -> PrivyApiException.Code.RATE_LIMITED;
            default -> e.code() >= 500 ? PrivyApiException.Code.UNAVAILABLE
                    : PrivyApiException.Code.INVALID_RESPONSE;
        };
        return new PrivyApiException(code, e.code(), parseRetryAfter(e.rawResponse()));
    }

    private PrivyTokenVerifier tokenVerifier() {
        if (tokenVerifier == null) {
            throw new IllegalStateException("Configure token verification with a trusted JWKS URL or verification public key");
        }
        return tokenVerifier;
    }

    private static Duration parseRetryAfter(HttpResponse<?> response) {
        if (response == null) return null;
        String value = response.headers().firstValue("Retry-After").orElse(null);
        if (value == null) return null;
        try {
            long seconds = Long.parseLong(value.strip());
            return seconds >= 0 ? Duration.ofSeconds(seconds) : null;
        } catch (NumberFormatException e) {
            try {
                Instant retryAt = ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
                Duration remaining = Duration.between(Instant.now(), retryAt);
                return remaining.isNegative() ? Duration.ZERO : remaining;
            } catch (DateTimeParseException invalidDate) {
                return null;
            }
        }
    }

    // Internal extension point for future wrapper operations; not part of the public API.
    io.privy.api.PrivyClient sdk() { return delegate; }
}
