# 전체 공개 API 대응표

공통 동작은 [Contract](recanet-sdk-contract.md), 상세 인자·반환·오류는 [API 명세](api-reference.md), 현재 불일치는 [차이 목록](gaps.md)을 따른다. 이 표는 `api-map.json`에서 생성했다. mapped는 공개 API 연결을 뜻하며 동작 준수 판정이 아니다.

Java 공개 선언 363개(생성자·overload·상수·record accessor·enum 보조 포함), TypeScript 공개 시그니처 416개를 추적한다. Java Object/Throwable 상속 API와 비공개 최상위 타입은 공통 업무 API에서 제외한다.

## AssetClient

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final long CHAIN_ID = 421614l;` | `AssetClient.CHAIN_ID` | mapped | [규칙](api-reference.md#asset) |
| `public static final String SYMBOL = "ETH";` | `AssetClient.SYMBOL` | mapped | [규칙](api-reference.md#asset) |
| `public static final int DECIMALS = 18;` | `AssetClient.DECIMALS` | mapped | [규칙](api-reference.md#asset) |
| `public AssetClient(URI);` | `AssetClient.new` | mapped | [규칙](api-reference.md#asset) |
| `public AssetClient(EvmRpc);` | `AssetClient.new` | mapped | [규칙](api-reference.md#asset) |
| `public BigInteger getBalance(String);` | `AssetClient.getBalance` | mapped | [규칙](api-reference.md#asset) |
| `public String transfer(EvmSigner, String, BigInteger, String);` | `AssetClient.transfer` | mapped | [규칙](api-reference.md#asset) |

## AuthenticatedUser

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public AuthenticatedUser(String, String, String, Instant, Instant);` | `AuthenticatedUser` | mapped | [규칙](api-reference.md#models) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#models) |
| `public String appId();` | `AuthenticatedUser.appId` | mapped | [규칙](api-reference.md#models) |
| `public String userId();` | `AuthenticatedUser.userId` | mapped | [규칙](api-reference.md#models) |
| `public String sessionId();` | `AuthenticatedUser.sessionId` | mapped | [규칙](api-reference.md#models) |
| `public Instant issuedAt();` | `AuthenticatedUser.issuedAtMs` | mapped | [규칙](api-reference.md#models) |
| `public Instant expiresAt();` | `AuthenticatedUser.expiresAtMs` | mapped | [규칙](api-reference.md#models) |

## BackendWallet

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public BackendWallet(String, String, String, String);` | `BackendWallet` | mapped | [규칙](api-reference.md#models) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#models) |
| `public String id();` | `BackendWallet.id` | mapped | [규칙](api-reference.md#models) |
| `public String address();` | `BackendWallet.address` | mapped | [규칙](api-reference.md#models) |
| `public String publicKey();` | `BackendWallet.publicKey` | mapped | [규칙](api-reference.md#models) |
| `public String chainType();` | `BackendWallet.chainType` | mapped | [규칙](api-reference.md#models) |

## BackendWalletCreateRequest

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public BackendWalletCreateRequest(String, String, String);` | `BackendWalletCreateRequest.new` | mapped | [규칙](api-reference.md#wallet) |
| `public BackendWalletCreateRequest(String);` | `BackendWalletCreateRequest.new` | mapped | [규칙](api-reference.md#wallet) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public String chainType();` | `BackendWalletCreateRequest.chainType` | mapped | [규칙](api-reference.md#wallet) |
| `public String displayName();` | `BackendWalletCreateRequest.displayName` | mapped | [규칙](api-reference.md#wallet) |
| `public String externalId();` | `BackendWalletCreateRequest.externalId` | mapped | [규칙](api-reference.md#wallet) |

## BackendWalletKeyPair

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public BackendWalletKeyPair(String, String);` | `BackendWalletKeyPair.new` | mapped | [규칙](api-reference.md#wallet) |
| `public static BackendWalletKeyPair generate();` | `BackendWalletKeyPair.generate` | mapped | [규칙](api-reference.md#wallet) |
| `public static BackendWalletKeyPair generateAndLog();` | `BackendWalletKeyPair.generateAndLog` | mapped | [규칙](api-reference.md#wallet) |
| `public BackendWalletRegistration registration();` | `BackendWalletKeyPair.registration` | mapped | [규칙](api-reference.md#wallet) |
| `public String toString();` | `BackendWalletKeyPair.toString` | mapped | [규칙](api-reference.md#wallet) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public String publicKey();` | `BackendWalletKeyPair.publicKey` | mapped | [규칙](api-reference.md#wallet) |
| `public String privateKey();` | `BackendWalletKeyPair.privateKey` | mapped | [규칙](api-reference.md#wallet) |

## BackendWalletRegistration

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public BackendWalletRegistration(String, String);` | `BackendWalletRegistration.new` | mapped | [규칙](api-reference.md#wallet) |
| `public static BackendWalletRegistration fromEnvironment();` | `BackendWalletRegistration.fromEnvironment` | mapped | [규칙](api-reference.md#wallet) |
| `public String toString();` | `BackendWalletRegistration.toString` | mapped | [규칙](api-reference.md#wallet) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#wallet) |
| `public String publicKey();` | `BackendWalletRegistration.publicKey` | mapped | [규칙](api-reference.md#wallet) |
| `public String privateKey();` | `BackendWalletRegistration.privateKey` | mapped | [규칙](api-reference.md#wallet) |

## EvmTransaction

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public EvmTransaction(long, String, String, String, BigInteger, BigInteger, String, BigInteger, BigInteger, BigInteger, BigInteger, Long, String, Integer, EvmTransactionStatus, Map<String, Object>, Map<String, Object>);` | `EvmTransaction` | mapped | [규칙](api-reference.md#transaction) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public long chainId();` | `EvmTransaction.chainId` | mapped | [규칙](api-reference.md#transaction) |
| `public String hash();` | `EvmTransaction.hash` | mapped | [규칙](api-reference.md#transaction) |
| `public String from();` | `EvmTransaction.from` | mapped | [규칙](api-reference.md#transaction) |
| `public String to();` | `EvmTransaction.to` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger valueWei();` | `EvmTransaction.valueWei` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger nonce();` | `EvmTransaction.nonce` | mapped | [규칙](api-reference.md#transaction) |
| `public String input();` | `EvmTransaction.input` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger gasLimit();` | `EvmTransaction.gasLimit` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger gasPriceWei();` | `EvmTransaction.gasPriceWei` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger maxFeePerGasWei();` | `EvmTransaction.maxFeePerGasWei` | mapped | [규칙](api-reference.md#transaction) |
| `public BigInteger maxPriorityFeePerGasWei();` | `EvmTransaction.maxPriorityFeePerGasWei` | mapped | [규칙](api-reference.md#transaction) |
| `public Long blockNumber();` | `EvmTransaction.blockNumber` | mapped | [규칙](api-reference.md#transaction) |
| `public String blockHash();` | `EvmTransaction.blockHash` | mapped | [규칙](api-reference.md#transaction) |
| `public Integer transactionIndex();` | `EvmTransaction.transactionIndex` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionStatus status();` | `EvmTransaction.status` | mapped | [규칙](api-reference.md#transaction) |
| `public Map<String, Object> transaction();` | `EvmTransaction.transaction` | mapped | [규칙](api-reference.md#transaction) |
| `public Map<String, Object> receipt();` | `EvmTransaction.receipt` | mapped | [규칙](api-reference.md#transaction) |

## EvmTransactionClient

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final int MAX_BLOCKS_PER_PAGE = 100;` | `EvmTransactionClient.MAX_BLOCKS_PER_PAGE` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionClient(long, URI);` | `EvmTransactionClient.new` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionClient(long, EvmRpc);` | `EvmTransactionClient.new` | mapped | [규칙](api-reference.md#transaction) |
| `public Optional<EvmTransaction> getTransaction(String);` | `EvmTransactionClient.getTransaction` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionStatus getTransactionStatus(String);` | `EvmTransactionClient.getTransactionStatus` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionPage listTransactions(String, int, String);` | `EvmTransactionClient.listTransactions` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionPage listTransactions(String, EvmTransactionQuery);` | `EvmTransactionClient.listTransactions` | mapped | [규칙](api-reference.md#transaction) |

## EvmTransactionPage

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public EvmTransactionPage(List<EvmTransaction>, String, long, long, int);` | `EvmTransactionPage` | mapped | [규칙](api-reference.md#transaction) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public List<EvmTransaction> transactions();` | `EvmTransactionPage.transactions` | mapped | [규칙](api-reference.md#transaction) |
| `public String nextCursor();` | `EvmTransactionPage.nextCursor` | mapped | [규칙](api-reference.md#transaction) |
| `public long fromBlock();` | `EvmTransactionPage.fromBlock` | mapped | [규칙](api-reference.md#transaction) |
| `public long toBlock();` | `EvmTransactionPage.toBlock` | mapped | [규칙](api-reference.md#transaction) |
| `public int scannedBlocks();` | `EvmTransactionPage.scannedBlocks` | mapped | [규칙](api-reference.md#transaction) |

## EvmTransactionQuery

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public EvmTransactionQuery(long, Long, int, String);` | `EvmTransactionQuery.new` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionQuery(long, Long, int);` | `EvmTransactionQuery.new` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionQuery withCursor(String);` | `EvmTransactionQuery.withCursor` | mapped | [규칙](api-reference.md#transaction) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public long fromBlock();` | `EvmTransactionQuery.fromBlock` | mapped | [규칙](api-reference.md#transaction) |
| `public Long toBlock();` | `EvmTransactionQuery.toBlock` | mapped | [규칙](api-reference.md#transaction) |
| `public int limit();` | `EvmTransactionQuery.limit` | mapped | [규칙](api-reference.md#transaction) |
| `public String cursor();` | `EvmTransactionQuery.cursor` | mapped | [규칙](api-reference.md#transaction) |

## EvmTransactionStatus

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public EvmTransactionStatus(long, String, EvmTransactionStatus$State, Long, long);` | `EvmTransactionStatus` | mapped | [규칙](api-reference.md#transaction) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#transaction) |
| `public long chainId();` | `EvmTransactionStatus.chainId` | mapped | [규칙](api-reference.md#transaction) |
| `public String transactionHash();` | `EvmTransactionStatus.transactionHash` | mapped | [규칙](api-reference.md#transaction) |
| `public EvmTransactionStatus$State state();` | `EvmTransactionStatus.state` | mapped | [규칙](api-reference.md#transaction) |
| `public Long blockNumber();` | `EvmTransactionStatus.blockNumber` | mapped | [규칙](api-reference.md#transaction) |
| `public long confirmations();` | `EvmTransactionStatus.confirmations` | mapped | [규칙](api-reference.md#transaction) |

## EvmTransactionStatus$State

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final EvmTransactionStatus$State NOT_FOUND;` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static final EvmTransactionStatus$State PENDING;` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static final EvmTransactionStatus$State MINED;` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static final EvmTransactionStatus$State SUCCEEDED;` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static final EvmTransactionStatus$State REVERTED;` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static EvmTransactionStatus$State[] values();` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |
| `public static EvmTransactionStatus$State valueOf(String);` | `EvmTransactionState` | mapped | [규칙](api-reference.md#transaction) |

## PrivyApiException

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyApiException$Code code();` | `PrivyApiError.code` | mapped | [규칙](api-reference.md#errors) |
| `public int statusCode();` | `PrivyApiError.statusCode` | mapped | [규칙](api-reference.md#errors) |
| `public Optional<Duration> retryAfter();` | `PrivyApiError.retryAfterMs` | mapped | [규칙](api-reference.md#errors) |

## PrivyApiException$Code

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final PrivyApiException$Code INVALID_CREDENTIALS;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyApiException$Code FORBIDDEN;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyApiException$Code RATE_LIMITED;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyApiException$Code UNAVAILABLE;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyApiException$Code INVALID_RESPONSE;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyApiException$Code INTERRUPTED;` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static PrivyApiException$Code[] values();` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static PrivyApiException$Code valueOf(String);` | `PrivyApiErrorCode` | mapped | [규칙](api-reference.md#errors) |

## PrivyAuthenticationException

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyAuthenticationException$Code code();` | `PrivyAuthenticationError.code` | mapped | [규칙](api-reference.md#errors) |

## PrivyAuthenticationException$Code

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final PrivyAuthenticationException$Code MISSING_TOKEN;` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyAuthenticationException$Code INVALID_TOKEN;` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyAuthenticationException$Code EXPIRED_TOKEN;` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final PrivyAuthenticationException$Code KEY_SOURCE_UNAVAILABLE;` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static PrivyAuthenticationException$Code[] values();` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static PrivyAuthenticationException$Code valueOf(String);` | `PrivyAuthenticationErrorCode` | mapped | [규칙](api-reference.md#errors) |

## PrivyClient

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyClient(PrivyClientConfig);` | `PrivyClient.new` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyClient(PrivyClientConfig, HttpClient);` | `PrivyClient.new` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyClientConfig config();` | `PrivyClient.config` | mapped | [규칙](api-reference.md#auth) |
| `public void verifyAppCredentials();` | `PrivyClient.verifyAppCredentials` | mapped | [규칙](api-reference.md#auth) |
| `public AuthenticatedUser verifyAccessToken(String);` | `PrivyClient.verifyAccessToken` | mapped | [규칙](api-reference.md#auth) |
| `public AuthenticatedUser authenticateAuthorizationHeader(String);` | `PrivyClient.authenticateAuthorizationHeader` | mapped | [규칙](api-reference.md#auth) |
| `public BackendWallet registerBackendWallet(BackendWalletRegistration, BackendWalletCreateRequest);` | `PrivyClient.registerBackendWallet` | mapped | [규칙](api-reference.md#auth) |
| `public boolean isBackendWallet(String, BackendWalletRegistration);` | `PrivyClient.isBackendWallet` | mapped | [규칙](api-reference.md#auth) |
| `public List<BackendWallet> listWalletsByAuthorizationKey(String);` | `PrivyClient.listWalletsByAuthorizationKey` | mapped | [규칙](api-reference.md#auth) |
| `public BackendWallet ensureBackendWallet(BackendWalletCreateRequest);` | `PrivyClient.ensureBackendWallet` | mapped | [규칙](api-reference.md#auth) |
| `public String exportWalletPrivateKey(String, BackendWalletRegistration);` | `PrivyClient.exportWalletPrivateKey` | mapped | [규칙](api-reference.md#auth) |
| `public String exportWalletPrivateKeyAndLog(String, BackendWalletRegistration);` | `PrivyClient.exportWalletPrivateKeyAndLog` | mapped | [규칙](api-reference.md#auth) |

## PrivyClientConfig

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyClientConfig(String, String);` | `PrivyClientConfig.new` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyClientConfig(String, String, URI, Duration);` | `PrivyClientConfig.new` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyClientConfig withTokenVerification(PrivyTokenVerificationConfig);` | `PrivyClientConfig.withTokenVerification` | mapped | [규칙](api-reference.md#auth) |
| `public String appId();` | `PrivyClientConfig.appId` | mapped | [규칙](api-reference.md#auth) |
| `public String appSecret();` | `PrivyClientConfig.appSecret` | mapped | [규칙](api-reference.md#auth) |
| `public URI baseUri();` | `PrivyClientConfig.baseUri` | mapped | [규칙](api-reference.md#auth) |
| `public Duration requestTimeout();` | `PrivyClientConfig.requestTimeout` | mapped | [규칙](api-reference.md#auth) |
| `public String toString();` | `PrivyClientConfig.toString` | mapped | [규칙](api-reference.md#auth) |

## PrivyEvmSigner

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyEvmSigner(PrivyClient, String, BackendWalletRegistration);` | `PrivyClient.signerForWallet` | mapped | [규칙](api-reference.md#signer) |
| `public String address();` | `EvmSigner.address` | mapped | [규칙](api-reference.md#signer) |
| `public String signMessage(String);` | `EvmSigner.signMessage` | mapped | [규칙](api-reference.md#signer) |
| `public String signTypedData(Map<String, Object>);` | `EvmSigner.signTypedData` | mapped | [규칙](api-reference.md#signer) |
| `public String sendTransaction(long, Map<String, Object>, String);` | `EvmSigner.sendTransaction` | mapped | [규칙](api-reference.md#signer) |

## PrivyTokenVerificationConfig

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static PrivyTokenVerificationConfig usingJwks(URI);` | `PrivyTokenVerificationConfig.usingJwks` | mapped | [규칙](api-reference.md#auth) |
| `public static PrivyTokenVerificationConfig usingPublicKey(String);` | `PrivyTokenVerificationConfig.usingPublicKey` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyTokenVerificationConfig withClockSkew(Duration);` | `PrivyTokenVerificationConfig.withClockSkew` | mapped | [규칙](api-reference.md#auth) |
| `public PrivyTokenVerificationConfig withJwksPolicy(Duration, Duration, Duration);` | `PrivyTokenVerificationConfig.withJwksPolicy` | mapped | [규칙](api-reference.md#auth) |
| `public Duration clockSkew();` | `PrivyTokenVerificationConfig.clockSkew` | mapped | [규칙](api-reference.md#auth) |
| `public Duration jwksTimeout();` | `PrivyTokenVerificationConfig.jwksTimeout` | mapped | [규칙](api-reference.md#auth) |
| `public Duration cacheTtl();` | `PrivyTokenVerificationConfig.cacheTtl` | mapped | [규칙](api-reference.md#auth) |
| `public Duration refreshCooldown();` | `PrivyTokenVerificationConfig.refreshCooldown` | mapped | [규칙](api-reference.md#auth) |

## PrivyTokenVerifier

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public PrivyTokenVerifier(String, PrivyTokenVerificationConfig);` | `PrivyTokenVerifier.new` | mapped | [규칙](api-reference.md#auth) |
| `public AuthenticatedUser verifyAccessToken(String);` | `PrivyTokenVerifier.verifyAccessToken` | mapped | [규칙](api-reference.md#auth) |
| `public AuthenticatedUser authenticateAuthorizationHeader(String);` | `PrivyTokenVerifier.authenticateAuthorizationHeader` | mapped | [규칙](api-reference.md#auth) |

## TransactionQueryException

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public TransactionQueryException$Code code();` | `TransactionQueryError.code` | mapped | [규칙](api-reference.md#errors) |

## TransactionQueryException$Code

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final TransactionQueryException$Code RPC_UNAVAILABLE;` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final TransactionQueryException$Code INVALID_RESPONSE;` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final TransactionQueryException$Code WRONG_CHAIN;` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final TransactionQueryException$Code CHAIN_CHANGED;` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final TransactionQueryException$Code INTERRUPTED;` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static TransactionQueryException$Code[] values();` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static TransactionQueryException$Code valueOf(String);` | `TransactionQueryErrorCode` | mapped | [규칙](api-reference.md#errors) |

## UserWallet

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public UserWallet(String, String, String, String);` | `UserWallet` | mapped | [규칙](api-reference.md#models) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#models) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#models) |
| `public String userId();` | `UserWallet.userId` | mapped | [규칙](api-reference.md#models) |
| `public String id();` | `UserWallet.id` | mapped | [규칙](api-reference.md#models) |
| `public String address();` | `UserWallet.address` | mapped | [규칙](api-reference.md#models) |
| `public String chainType();` | `UserWallet.chainType` | mapped | [규칙](api-reference.md#models) |

## UserWalletClient

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public UserWalletClient(PrivyClient, BackendWalletRegistration, String);` | `PrivyClient.userWallets` | mapped | [규칙](api-reference.md#wallet) |
| `public BeneficiaryWallets forPartner(long, UserWalletClient$WalletAuthorization);` | `UserWalletClient.forPartner` | mapped | [규칙](api-reference.md#wallet) |
| `public UserWallet getOrCreateWallet(String);` | `UserWalletClient.getOrCreateWallet` | mapped | [규칙](api-reference.md#wallet) |
| `public Optional<UserWallet> findWallet(String);` | `UserWalletClient.findWallet` | mapped | [규칙](api-reference.md#wallet) |
| `public String signMessage(String, String);` | `UserWalletClient.signMessage` | mapped | [규칙](api-reference.md#wallet) |
| `public String signTypedData(String, Map<String, Object>);` | `UserWalletClient.signTypedData` | mapped | [규칙](api-reference.md#wallet) |
| `public String sendTransaction(String, long, Map<String, Object>, String);` | `UserWalletClient.sendTransaction` | mapped | [규칙](api-reference.md#wallet) |
| `public EvmSigner signerFor(String);` | `UserWalletClient.signerFor` | mapped | [규칙](api-reference.md#wallet) |

## UserWalletClient$WalletAuthorization

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract boolean isAuthorized(long, String);` | `WalletAuthorization` | mapped | [규칙](api-reference.md#wallet) |

## ActivityRequest

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public ActivityRequest(String, String, Map<String, Object>);` | `ActivityRequest.new` | mapped | [규칙](api-reference.md#activity) |
| `public ActivityRequest(String, String, Map<String, Object>, String, String, String, Duration, Duration);` | `ActivityRequest.new` | mapped | [규칙](api-reference.md#activity) |
| `public Map<String, Object> inputs();` | `ActivityRequest.inputs` | mapped | [규칙](api-reference.md#activity) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#activity) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#activity) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#activity) |
| `public String userId();` | `ActivityRequest.userId` | mapped | [규칙](api-reference.md#activity) |
| `public String sourceEventId();` | `ActivityRequest.sourceEventId` | mapped | [규칙](api-reference.md#activity) |
| `public String claimId();` | `ActivityRequest.claimId` | mapped | [규칙](api-reference.md#activity) |
| `public String objectName();` | `ActivityRequest.objectName` | mapped | [규칙](api-reference.md#activity) |
| `public String gas();` | `ActivityRequest.gas` | mapped | [규칙](api-reference.md#activity) |
| `public Duration confirmationTimeout();` | `ActivityRequest.confirmationTimeout` | mapped | [규칙](api-reference.md#activity) |
| `public Duration pollInterval();` | `ActivityRequest.pollInterval` | mapped | [규칙](api-reference.md#activity) |

## BeneficiaryWallets

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract EvmSigner getOrCreateSigner(long, String);` | `BeneficiaryWallets.getOrCreateSigner` | mapped | [규칙](api-reference.md#adapters) |

## DeclaredMethodology

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final String PET_HASH = "0xdcc09ee621f2e388dd858f8f7399dbf2725cbec3526d52b0dd06909da892ff77";` | `DeclaredMethodology.PET_HASH` | mapped | [규칙](api-reference.md#methodology) |
| `public DeclaredMethodology(byte[], byte[], String, DeclaredMethodology$Registry);` | `DeclaredMethodology.new` | mapped | [규칙](api-reference.md#methodology) |
| `public DeclaredMethodology(byte[], byte[], String, DeclaredMethodology$Registry, int);` | `DeclaredMethodology.new` | mapped | [규칙](api-reference.md#methodology) |
| `public String hash();` | `DeclaredMethodology.hash` | mapped | [규칙](api-reference.md#methodology) |
| `public long activityId();` | `DeclaredMethodology.activityId` | mapped | [규칙](api-reference.md#methodology) |
| `public long id();` | `DeclaredMethodology.id` | mapped | [규칙](api-reference.md#methodology) |
| `public long version();` | `DeclaredMethodology.version` | mapped | [규칙](api-reference.md#methodology) |
| `public void verifyActive();` | `DeclaredMethodology.verifyActive` | mapped | [규칙](api-reference.md#methodology) |
| `public Map<String, Object> evidenceBody(long, String, String, Map<String, Object>);` | `DeclaredMethodology.evidenceBody` | mapped | [규칙](api-reference.md#methodology) |

## DeclaredMethodology$Registry

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract boolean isActive(long, long, long, String);` | `MethodologyRegistry` | mapped | [규칙](api-reference.md#methodology) |

## DmrvnClient

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public DmrvnClient(DmrvnConfig, EvmRpc, EvmSigner, GreenfieldStorage, DeclaredMethodology);` | `DmrvnClient.new` | mapped | [규칙](api-reference.md#workflow) |
| `public DmrvnClient(DmrvnConfig, EvmRpc, EvmSigner, GreenfieldStorage, DeclaredMethodology, OperationJournal);` | `DmrvnClient.new` | mapped | [규칙](api-reference.md#workflow) |
| `public DmrvnClient(DmrvnConfig, EvmRpc, EvmSigner, EvmSigner, GreenfieldStorage, DeclaredMethodology, OperationJournal);` | `DmrvnClient.new` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> preflight();` | `DmrvnClient.preflight` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> prepareEvidence(String, String, String, String, Map<String, Object>);` | `DmrvnClient.prepareEvidence` | mapped | [규칙](api-reference.md#workflow) |
| `public void recoverCreateTransaction(String, String);` | `DmrvnClient.recoverCreateTransaction` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> approveClaim(String);` | `DmrvnClient.approveClaim` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> prepare(String, String, String, String, Map<String, Object>);` | `DmrvnClient.prepare` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> submitActivity(BeneficiaryWallets, ActivityRequest);` | `DmrvnClient.submitActivity` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> submitActivity(UserWalletClient, String, String, String, String, Map<String, Object>, String);` | `DmrvnClient.submitActivity` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> submitActivity(EvmSigner, String, String, String, Map<String, Object>, String);` | `DmrvnClient.submitActivity` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> prepareSponsored(String, String);` | `DmrvnClient.prepareSponsored` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> prepareSelfPaid(String);` | `DmrvnClient.prepareSelfPaid` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> recordSponsoredSignature(String, Map<String, Object>, String);` | `DmrvnClient.recordSponsoredSignature` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> submitSponsored(String, Map<String, Object>, String);` | `DmrvnClient.submitSponsored` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> resolveSubmission(String, String);` | `DmrvnClient.resolveSubmission` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> operation(String);` | `DmrvnClient.operation` | mapped | [규칙](api-reference.md#workflow) |
| `public Map<String, Object> readResult(String, DmrvnReader, Long, String, boolean);` | `DmrvnClient.readResult` | mapped | [규칙](api-reference.md#workflow) |

## DmrvnConfig

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public DmrvnConfig(long, URI, String, String, String, String, String, String, long, BigInteger, int, DmrvnDeployment);` | `DmrvnConfig.new` | mapped | [규칙](api-reference.md#deployment) |
| `public DmrvnConfig(long, URI, String, String, String, String, String, String, long, BigInteger, int);` | `DmrvnConfig.new` | mapped | [규칙](api-reference.md#deployment) |
| `public static DmrvnConfig petTestnet(long, String, BigInteger);` | `DmrvnConfig.petTestnet` | mapped | [규칙](api-reference.md#deployment) |
| `public static DmrvnConfig historicalDirectTestnet(long, String, BigInteger);` | `DmrvnConfig.historicalDirectTestnet` | mapped | [규칙](api-reference.md#deployment) |
| `public static DmrvnConfig fromDeployment(DmrvnDeployment, URI, String, String, String, long, BigInteger, int);` | `DmrvnConfig.fromDeployment` | mapped | [규칙](api-reference.md#deployment) |
| `public String deploymentId();` | `DmrvnConfig.deploymentId` | mapped | [규칙](api-reference.md#deployment) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#deployment) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#deployment) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#deployment) |
| `public long chainId();` | `DmrvnConfig.chainId` | mapped | [규칙](api-reference.md#deployment) |
| `public URI rpcUrl();` | `DmrvnConfig.rpcUrl` | mapped | [규칙](api-reference.md#deployment) |
| `public String claimAddress();` | `DmrvnConfig.claimAddress` | mapped | [규칙](api-reference.md#deployment) |
| `public String forwarderAddress();` | `DmrvnConfig.forwarderAddress` | mapped | [규칙](api-reference.md#deployment) |
| `public String claimRuntimeCodeHash();` | `DmrvnConfig.claimRuntimeCodeHash` | mapped | [규칙](api-reference.md#deployment) |
| `public String greenfieldChainId();` | `DmrvnConfig.greenfieldChainId` | mapped | [규칙](api-reference.md#deployment) |
| `public String bucketName();` | `DmrvnConfig.bucketName` | mapped | [규칙](api-reference.md#deployment) |
| `public String objectPrefix();` | `DmrvnConfig.objectPrefix` | mapped | [규칙](api-reference.md#deployment) |
| `public long partnerId();` | `DmrvnConfig.partnerId` | mapped | [규칙](api-reference.md#deployment) |
| `public BigInteger maxRelayCostWei();` | `DmrvnConfig.maxRelayCostWei` | mapped | [규칙](api-reference.md#deployment) |
| `public int confirmations();` | `DmrvnConfig.confirmations` | mapped | [규칙](api-reference.md#deployment) |
| `public DmrvnDeployment deployment();` | `DmrvnConfig.deployment` | mapped | [규칙](api-reference.md#deployment) |

## DmrvnDeployment

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static DmrvnDeployment fromManifest(Map<String, Object>);` | `DmrvnDeployment.fromManifest` | mapped | [규칙](api-reference.md#deployment) |
| `public static DmrvnDeployment testnet();` | `DmrvnDeployment.testnet` | mapped | [규칙](api-reference.md#deployment) |
| `public static DmrvnDeployment historicalDirectTestnet();` | `DmrvnDeployment.historicalDirectTestnet` | mapped | [규칙](api-reference.md#deployment) |
| `public Map<String, Object> snapshot();` | `DmrvnDeployment.snapshot` | mapped | [규칙](api-reference.md#deployment) |
| `public long chainId();` | `DmrvnDeployment.chainId` | mapped | [규칙](api-reference.md#deployment) |
| `public String contractAddress();` | `DmrvnDeployment.contractAddress` | mapped | [규칙](api-reference.md#deployment) |
| `public String forwarderAddress();` | `DmrvnDeployment.forwarderAddress` | mapped | [규칙](api-reference.md#deployment) |
| `public boolean isProxy();` | `DmrvnDeployment.isProxy` | mapped | [규칙](api-reference.md#deployment) |
| `public String runtimeCodeHash();` | `DmrvnDeployment.runtimeCodeHash` | mapped | [규칙](api-reference.md#deployment) |

## DmrvnException

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public DmrvnException(DmrvnException$Code);` | `DmrvnError.new` | mapped | [규칙](api-reference.md#errors) |
| `public boolean definitelyNotBroadcast();` | `DmrvnError.definitelyNotBroadcast` | mapped | [규칙](api-reference.md#errors) |
| `public boolean definitelyRejected();` | `DmrvnError.definitelyRejected` | mapped | [규칙](api-reference.md#errors) |
| `public DmrvnException$Code code();` | `DmrvnError.code` | mapped | [규칙](api-reference.md#errors) |
| `public boolean retryable();` | `DmrvnError.retryable` | mapped | [규칙](api-reference.md#errors) |
| `public String action();` | `DmrvnError.action` | mapped | [규칙](api-reference.md#errors) |

## DmrvnException$Code

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static final DmrvnException$Code INVALID_INPUT;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code EVIDENCE_CONTRACT_UNCONFIGURED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code WRONG_CHAIN;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code DEPLOYMENT_MISMATCH;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code DEPLOYMENT_NOT_READY;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code UNAPPROVED_IMPLEMENTATION;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code DEPLOYMENT_COLLISION;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code UNAUTHORIZED_SIGNER;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code OPERATION_INPUT_CHANGED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code OPERATION_NOT_PREPARED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code SUBMISSION_INPUT_CHANGED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code SUBMISSION_UNRESOLVED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code STORAGE_ACCESS_DENIED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code OBJECT_UNSEALED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code STORAGE_UNAVAILABLE;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code STORAGE_CREATE_UNRESOLVED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code STORAGE_ACCOUNT_UNFUNDED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code STORAGE_MISMATCH;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code SIGNATURE_INVALID;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code REQUEST_EXPIRED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code NONCE_CONFLICT;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code INSUFFICIENT_FUNDS;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code GAS_ESTIMATION_FAILED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code RPC_UNAVAILABLE;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code REPORT_LOOKUP_RANGE;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code REPORT_TX_NOT_FOUND;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code REPORT_READ_FAILED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code REPORT_MISMATCH;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code JOURNAL_UNAVAILABLE;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code INTERRUPTED;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static final DmrvnException$Code METHODOLOGY_UNAVAILABLE;` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static DmrvnException$Code[] values();` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |
| `public static DmrvnException$Code valueOf(String);` | `DmrvnErrorCode` | mapped | [규칙](api-reference.md#errors) |

## DmrvnProtocol

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static String verifyProvenance(Map<String, Object>, String, String);` | `DmrvnProtocol.verifyProvenance` | mapped | [규칙](api-reference.md#protocol) |
| `public static Map<String, Object> domain(long, String, boolean);` | `DmrvnProtocol.domain` | mapped | [규칙](api-reference.md#protocol) |
| `public static Map<String, Object> typedData(String, Map<String, Object>, Map<String, Object>);` | `DmrvnProtocol.typedData` | mapped | [규칙](api-reference.md#protocol) |
| `public static String digest(String, Map<String, Object>, Map<String, Object>);` | `DmrvnProtocol.digest` | mapped | [규칙](api-reference.md#protocol) |
| `public static String structHash(String, Map<String, Object>);` | `DmrvnProtocol.structHash` | mapped | [규칙](api-reference.md#protocol) |
| `public static String recover(String, String);` | `DmrvnProtocol.recover` | mapped | [규칙](api-reference.md#protocol) |
| `public static String ownerHash(String);` | `DmrvnProtocol.ownerHash` | mapped | [규칙](api-reference.md#protocol) |
| `public static String evidenceLocationHash(Map<String, Object>);` | `DmrvnProtocol.evidenceLocationHash` | mapped | [규칙](api-reference.md#protocol) |
| `public static String submitCalldata(Map<String, Object>);` | `DmrvnProtocol.submitCalldata` | mapped | [규칙](api-reference.md#protocol) |
| `public static String executeCalldata(Map<String, Object>, String);` | `DmrvnProtocol.executeCalldata` | mapped | [규칙](api-reference.md#protocol) |

## DmrvnReader

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public DmrvnReader(DmrvnConfig, EvmRpc, DmrvnReader$ReportReader, DmrvnReader$ReportResolver);` | `DmrvnReader.new` | mapped | [규칙](api-reference.md#reader) |
| `public static DmrvnReader$ReportResolver defaultReportResolver(String, String);` | `DmrvnReader.defaultReportResolver` | mapped | [규칙](api-reference.md#reader) |
| `public Map<String, Object> readResult(String, Long, String, boolean, String);` | `DmrvnReader.readResult` | mapped | [규칙](api-reference.md#reader) |
| `public String verifyEvidenceProvenance(String, byte[]);` | `DmrvnReader.verifyEvidenceProvenance` | mapped | [규칙](api-reference.md#reader) |

## DmrvnReader$ReportReader

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract byte[] read(Map<String, Object>);` | `ReportReader.read` | mapped | [규칙](api-reference.md#reader) |

## DmrvnReader$ReportResolver

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract Map<String, Object> resolve(String);` | `ReportResolver.resolve` | mapped | [규칙](api-reference.md#reader) |

## EvmRpc

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract Object call(String, List<Object>);` | `EvmRpc.call` | mapped | [규칙](api-reference.md#transport) |

## EvmSigner

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract String address();` | `EvmSigner.address` | mapped | [규칙](api-reference.md#signer) |
| `public abstract String signMessage(String);` | `EvmSigner.signMessage` | mapped | [규칙](api-reference.md#signer) |
| `public abstract String signTypedData(Map<String, Object>);` | `EvmSigner.signTypedData` | mapped | [규칙](api-reference.md#signer) |
| `public abstract String sendTransaction(long, Map<String, Object>, String);` | `EvmSigner.sendTransaction` | mapped | [규칙](api-reference.md#signer) |

## FileOperationJournal

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public FileOperationJournal(Path);` | `FileOperationJournal.new` | mapped | [규칙](api-reference.md#journal) |
| `public <T> T withLock(String, Supplier<T>);` | `FileOperationJournal.withLock` | mapped | [규칙](api-reference.md#journal) |
| `public Map<String, Object> load(String);` | `FileOperationJournal.load` | mapped | [규칙](api-reference.md#journal) |
| `public List<Map<String, Object>> findOperationsByClaimId(String);` | `FileOperationJournal.findOperationsByClaimId` | mapped | [규칙](api-reference.md#journal) |
| `public void store(String, Map<String, Object>);` | `FileOperationJournal.store` | mapped | [규칙](api-reference.md#journal) |

## GreenfieldPublicReader

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public GreenfieldPublicReader(URI, String);` | `GreenfieldPublicReader.new` | mapped | [규칙](api-reference.md#storage) |
| `public byte[] read(Map<String, Object>);` | `GreenfieldPublicReader.read` | mapped | [규칙](api-reference.md#storage) |

## GreenfieldStorage

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract String address();` | `GreenfieldStorage.address` | mapped | [규칙](api-reference.md#storage) |
| `public abstract String chainId();` | `GreenfieldStorage.chainId` | mapped | [규칙](api-reference.md#storage) |
| `public abstract GreenfieldStorage$Head head(Map<String, Object>);` | `GreenfieldStorage.head` | mapped | [규칙](api-reference.md#storage) |
| `public abstract String create(Map<String, Object>, byte[]);` | `GreenfieldStorage.create` | mapped | [규칙](api-reference.md#storage) |
| `public abstract void upload(Map<String, Object>, byte[], String);` | `GreenfieldStorage.upload` | mapped | [규칙](api-reference.md#storage) |
| `public abstract byte[] read(Map<String, Object>);` | `GreenfieldStorage.read` | mapped | [규칙](api-reference.md#storage) |
| `public abstract boolean matchesCreateTransaction(Map<String, Object>, String);` | `GreenfieldStorage.matchesCreateTransaction` | mapped | [규칙](api-reference.md#storage) |

## GreenfieldStorage$Head

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public GreenfieldStorage$Head(boolean, boolean);` | `GreenfieldHead` | mapped | [규칙](api-reference.md#storage) |
| `public final String toString();` | 없음 | language | [규칙](api-reference.md#storage) |
| `public final int hashCode();` | 없음 | language | [규칙](api-reference.md#storage) |
| `public final boolean equals(Object);` | 없음 | language | [규칙](api-reference.md#storage) |
| `public boolean exists();` | `GreenfieldHead.exists` | mapped | [규칙](api-reference.md#storage) |
| `public boolean sealed();` | `GreenfieldHead.sealed` | mapped | [규칙](api-reference.md#storage) |

## HttpEvmRpc

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public HttpEvmRpc(URI);` | `HttpEvmRpc.new` | mapped | [규칙](api-reference.md#transport) |
| `public HttpEvmRpc(URI, HttpClient, Duration);` | `HttpEvmRpc.new` | mapped | [규칙](api-reference.md#transport) |
| `public Object call(String, List<Object>);` | `HttpEvmRpc.call` | mapped | [규칙](api-reference.md#transport) |

## Json

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public static Object parse(byte[]);` | `Json.parse` | mapped | [규칙](api-reference.md#json) |
| `public static Map<String, Object> object(byte[]);` | `Json.object` | mapped | [규칙](api-reference.md#json) |
| `public static Map<String, Object> copy(Map<String, Object>);` | `Json.copy` | mapped | [규칙](api-reference.md#json) |
| `public static byte[] bytes(Object);` | `Json.bytes` | mapped | [규칙](api-reference.md#json) |
| `public static String hash(Object);` | `Json.hash` | mapped | [규칙](api-reference.md#json) |
| `public static String canonical(Object);` | `Json.canonical` | mapped | [규칙](api-reference.md#json) |

## NodeGreenfieldStorage

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public NodeGreenfieldStorage(Path, Path, URI, String, String, String, String, Duration);` | `NodeGreenfieldStorage.new` | mapped | [규칙](api-reference.md#storage) |
| `public String address();` | `NodeGreenfieldStorage.address` | mapped | [규칙](api-reference.md#storage) |
| `public String chainId();` | `NodeGreenfieldStorage.chainId` | mapped | [규칙](api-reference.md#storage) |
| `public GreenfieldStorage$Head head(Map<String, Object>);` | `NodeGreenfieldStorage.head` | mapped | [규칙](api-reference.md#storage) |
| `public String create(Map<String, Object>, byte[]);` | `NodeGreenfieldStorage.create` | mapped | [규칙](api-reference.md#storage) |
| `public void upload(Map<String, Object>, byte[], String);` | `NodeGreenfieldStorage.upload` | mapped | [규칙](api-reference.md#storage) |
| `public byte[] read(Map<String, Object>);` | `NodeGreenfieldStorage.read` | mapped | [규칙](api-reference.md#storage) |
| `public boolean matchesCreateTransaction(Map<String, Object>, String);` | `NodeGreenfieldStorage.matchesCreateTransaction` | mapped | [규칙](api-reference.md#storage) |

## OperationJournal

| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |
| --- | --- | --- | --- |
| `public abstract <T> T withLock(String, Supplier<T>);` | `OperationJournal.withLock` | mapped | [규칙](api-reference.md#journal) |
| `public abstract Map<String, Object> load(String);` | `OperationJournal.load` | mapped | [규칙](api-reference.md#journal) |
| `public default List<Map<String, Object>> findOperationsByClaimId(String);` | `OperationJournal.findOperationsByClaimId` | mapped | [규칙](api-reference.md#journal) |
| `public abstract void store(String, Map<String, Object>);` | `OperationJournal.store` | mapped | [규칙](api-reference.md#journal) |

## Java 대응 없이 공개된 TypeScript API

타입 정의와 인자 options도 포함한다. 각 key의 정확한 시그니처·소스와 설명은 api-map.json의 typescript/typescriptCoverage에 있다.

| TypeScript 공개 key | 분류 | 계약 |
| --- | --- | --- |
| `ActivityOutcome` | binding | [규칙](api-reference.md#activity) |
| `ActivityOutcome.confirmed` | binding | [규칙](api-reference.md#activity) |
| `ActivityOutcome.errorCode` | binding | [규칙](api-reference.md#activity) |
| `ActivityOutcome.lastConfirmedStage` | binding | [규칙](api-reference.md#activity) |
| `ActivityOutcome.outcome` | binding | [규칙](api-reference.md#activity) |
| `ActivityOutcome.requested` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequest` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequest.confirmationTimeoutMs` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequest.pollIntervalMs` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.claimId` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.confirmationTimeout` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.confirmationTimeoutMs` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.gas` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.objectName` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.pollInterval` | binding | [규칙](api-reference.md#activity) |
| `ActivityRequestOptions.pollIntervalMs` | binding | [규칙](api-reference.md#activity) |
| `ActivityStage` | binding | [규칙](api-reference.md#activity) |
| `AssetClient` | binding | [규칙](api-reference.md#asset) |
| `BackendWalletCreateRequest` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletKeyPair` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletKeyPair.[inspect.custom]` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletKeyPair.toJSON` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletRegistration` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletRegistration.generate` | binding | [규칙](api-reference.md#wallet) |
| `BackendWalletRegistration.toJSON` | binding | [규칙](api-reference.md#wallet) |
| `BeneficiaryWallets` | binding | [규칙](api-reference.md#adapters) |
| `DeclaredMethodology` | binding | [규칙](api-reference.md#methodology) |
| `DeploymentConfigOptions` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.bucketName` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.confirmations` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.greenfieldChainId` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.maxRelayCostWei` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.objectPrefix` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.partnerId` | binding | [규칙](api-reference.md#deployment) |
| `DeploymentConfigOptions.rpcUrl` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnClient` | binding | [규칙](api-reference.md#workflow) |
| `DmrvnConfig` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.bucketName` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.chainId` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.claimAddress` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.claimRuntimeCodeHash` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.confirmations` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.deployment` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.forwarderAddress` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.greenfieldChainId` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.maxRelayCostWei` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.objectPrefix` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.partnerId` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnConfigOptions.rpcUrl` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnDecimal` | binding | [규칙](api-reference.md#json) |
| `DmrvnDecimal.new` | binding | [규칙](api-reference.md#json) |
| `DmrvnDecimal.source` | binding | [규칙](api-reference.md#json) |
| `DmrvnDecimal.toJSON` | binding | [규칙](api-reference.md#json) |
| `DmrvnDecimal.toString` | binding | [규칙](api-reference.md#json) |
| `DmrvnDeployment` | binding | [규칙](api-reference.md#deployment) |
| `DmrvnError` | binding | [규칙](api-reference.md#errors) |
| `DmrvnProtocol` | binding | [규칙](api-reference.md#protocol) |
| `DmrvnReader` | binding | [규칙](api-reference.md#reader) |
| `DmrvnStructType` | binding | [규칙](api-reference.md#models) |
| `Duration` | binding | [규칙](api-reference.md#models) |
| `Duration.ZERO` | binding | [규칙](api-reference.md#models) |
| `Duration.compareTo` | binding | [규칙](api-reference.md#models) |
| `Duration.isNegative` | binding | [규칙](api-reference.md#models) |
| `Duration.isZero` | binding | [규칙](api-reference.md#models) |
| `Duration.nanoseconds` | binding | [규칙](api-reference.md#models) |
| `Duration.ofMillis` | binding | [규칙](api-reference.md#models) |
| `Duration.ofMinutes` | binding | [규칙](api-reference.md#models) |
| `Duration.ofNanos` | binding | [규칙](api-reference.md#models) |
| `Duration.ofSeconds` | binding | [규칙](api-reference.md#models) |
| `Duration.toMillis` | binding | [규칙](api-reference.md#models) |
| `Duration.toNanos` | binding | [규칙](api-reference.md#models) |
| `EvmRpc` | binding | [규칙](api-reference.md#transport) |
| `EvmSigner` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionClient` | binding | [규칙](api-reference.md#transaction) |
| `EvmTransactionInput` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.data` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.gas` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.gasPrice` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.nonce` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.to` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionInput.value` | binding | [규칙](api-reference.md#signer) |
| `EvmTransactionQuery` | binding | [규칙](api-reference.md#transaction) |
| `EvmTypedData` | binding | [규칙](api-reference.md#signer) |
| `EvmTypedData.domain` | binding | [규칙](api-reference.md#signer) |
| `EvmTypedData.message` | binding | [규칙](api-reference.md#signer) |
| `EvmTypedData.primaryType` | binding | [규칙](api-reference.md#signer) |
| `EvmTypedData.types` | binding | [규칙](api-reference.md#signer) |
| `FileOperationJournal` | binding | [규칙](api-reference.md#journal) |
| `Float32` | binding | [규칙](api-reference.md#signer) |
| `Float32.new` | binding | [규칙](api-reference.md#signer) |
| `Float32.toJSON` | binding | [규칙](api-reference.md#signer) |
| `Float32.toString` | binding | [규칙](api-reference.md#signer) |
| `Float32.value` | binding | [규칙](api-reference.md#signer) |
| `Float64` | binding | [규칙](api-reference.md#signer) |
| `Float64.new` | binding | [규칙](api-reference.md#signer) |
| `Float64.toJSON` | binding | [규칙](api-reference.md#signer) |
| `Float64.toString` | binding | [규칙](api-reference.md#signer) |
| `Float64.value` | binding | [규칙](api-reference.md#signer) |
| `GreenfieldIdentity` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldIdentity.address` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldIdentity.chainId` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldPublicReader` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldPublicReaderOptions` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldPublicReaderOptions.connectTimeoutMs` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldPublicReaderOptions.fetch` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldPublicReaderOptions.timeoutMs` | binding | [규칙](api-reference.md#storage) |
| `GreenfieldStorage` | binding | [규칙](api-reference.md#storage) |
| `HttpEvmRpc` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions.connectTimeout` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions.connectTimeoutMs` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions.fetch` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions.timeout` | binding | [규칙](api-reference.md#transport) |
| `HttpEvmRpcOptions.timeoutMs` | binding | [규칙](api-reference.md#transport) |
| `Json` | binding | [규칙](api-reference.md#models) |
| `JwksPolicy` | binding | [규칙](api-reference.md#auth) |
| `JwksPolicy.cacheTtlMs` | binding | [규칙](api-reference.md#auth) |
| `JwksPolicy.refreshCooldownMs` | binding | [규칙](api-reference.md#auth) |
| `JwksPolicy.timeoutMs` | binding | [규칙](api-reference.md#auth) |
| `NodeGreenfieldStorage` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.address` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.chainId` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.feeGranter` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.keyEnvironmentVariable` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.nodePath` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.rpcUrl` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.timeout` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.timeoutMs` | binding | [규칙](api-reference.md#storage) |
| `NodeGreenfieldStorageOptions.workerPath` | binding | [규칙](api-reference.md#storage) |
| `OperationJournal` | binding | [규칙](api-reference.md#journal) |
| `PrivyApiError` | binding | [규칙](api-reference.md#errors) |
| `PrivyApiError.new` | binding | [규칙](api-reference.md#errors) |
| `PrivyAuthenticationError` | binding | [규칙](api-reference.md#errors) |
| `PrivyAuthenticationError.new` | binding | [규칙](api-reference.md#errors) |
| `PrivyClient` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientConfig` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientConfig.toJSON` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.appId` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.appSecret` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.fetch` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.origin` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.requestTimeout` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.timeoutMs` | binding | [규칙](api-reference.md#auth) |
| `PrivyClientOptions.tokenVerification` | binding | [규칙](api-reference.md#auth) |
| `PrivyTokenVerificationConfig` | binding | [규칙](api-reference.md#auth) |
| `PrivyTokenVerifier` | binding | [규칙](api-reference.md#auth) |
| `ReadonlyJson` | binding | [규칙](api-reference.md#transaction) |
| `ReadonlyJsonObject` | binding | [규칙](api-reference.md#transaction) |
| `ReportReader` | binding | [규칙](api-reference.md#models) |
| `ReportResolver` | binding | [규칙](api-reference.md#models) |
| `TokenVerificationOptions` | binding | [규칙](api-reference.md#auth) |
| `TransactionQueryError` | binding | [규칙](api-reference.md#errors) |
| `TransactionQueryError.new` | binding | [규칙](api-reference.md#errors) |
| `UserWalletClient` | binding | [규칙](api-reference.md#wallet) |
