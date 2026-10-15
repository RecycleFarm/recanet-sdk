package com.youngminkim.recanet;

import com.youngminkim.recanet.dmrvn.*;

import io.privy.api.AuthorizationContext;
import io.privy.api.models.components.*;
import io.privy.api.models.errors.APIException;

import java.util.*;

/** Privy-backed provenance/EIP-712/Relay adapter. Never exports wallet keys. */
public final class PrivyEvmSigner implements EvmSigner {
    private final PrivyClient client;
    private final String walletId;
    private final String address;
    private final AuthorizationContext authorization;

    /** Verifies the wallet belongs to the configured authorization key using the Privy API. */
    public PrivyEvmSigner(
            PrivyClient client, String walletId, BackendWalletRegistration registration) {
        this.client = Objects.requireNonNull(client);
        this.walletId = Objects.requireNonNull(walletId);
        try {
            // Wallet public_key describes the blockchain key, not the P-256 authorization owner.
            // Query by authorization_key and select the exact wallet before requesting signatures.
            var wallet =
                    client.listWalletsByAuthorizationKey(registration.publicKey()).stream()
                            .filter(value -> walletId.equals(value.id()))
                            .findFirst()
                            .orElseThrow(
                                    () ->
                                            new DmrvnException(
                                                    DmrvnException.Code.UNAUTHORIZED_SIGNER));
            if (!"ethereum".equals(wallet.chainType()))
                throw new DmrvnException(DmrvnException.Code.UNAUTHORIZED_SIGNER);
            this.address = wallet.address();
        } catch (DmrvnException e) {
            throw e;
        } catch (Exception e) {
            throw failure(e);
        }
        this.authorization =
                AuthorizationContext.withAuthorizationPrivateKey(registration.privyPrivateKey());
    }

    @Override
    public String address() {
        return address;
    }

    @Override
    public String signMessage(String message) {
        try {
            return client.sdk()
                    .wallets()
                    .ethereum()
                    .signMessage(walletId, message, authorization)
                    .signature();
        } catch (Exception e) {
            throw failure(e);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public String signTypedData(Map<String, Object> typedData) {
        try {
            var types = new LinkedHashMap<String, List<TypedDataTypeFieldInput>>();
            ((Map<String, List<Map<String, Object>>>) typedData.get("types"))
                    .forEach(
                            (name, fields) ->
                                    types.put(
                                            name,
                                            fields.stream()
                                                    .map(
                                                            f ->
                                                                    TypedDataTypeFieldInput
                                                                            .builder()
                                                                            .name(
                                                                                    (String)
                                                                                            f.get(
                                                                                                    "name"))
                                                                            .type(
                                                                                    (String)
                                                                                            f.get(
                                                                                                    "type"))
                                                                            .build())
                                                    .toList()));
            var input =
                    EthereumTypedDataInput.builder()
                            .domain((Map<String, Object>) typedData.get("domain"))
                            .types(types)
                            .primaryType((String) typedData.get("primaryType"))
                            .message((Map<String, Object>) typedData.get("message"))
                            .build();
            return client.sdk()
                    .wallets()
                    .ethereum()
                    .signTypedData(walletId, input, authorization)
                    .signature();
        } catch (Exception e) {
            throw failure(e);
        }
    }

    @Override
    public String sendTransaction(long chainId, Map<String, Object> tx, String idempotencyKey) {
        try {
            var b =
                    UnsignedStandardEthereumTransaction.builder()
                            .from(address)
                            .to((String) tx.get("to"))
                            .chainId(Quantity.of("0x" + Long.toHexString(chainId)))
                            .value(Quantity.of((String) tx.get("value")))
                            .data((String) tx.get("data"))
                            .gasLimit(Quantity.of((String) tx.get("gas")))
                            .gasPrice(Quantity.of((String) tx.get("gasPrice")))
                            .nonce(Quantity.of((String) tx.get("nonce")));
            return client.sdk()
                    .wallets()
                    .ethereum()
                    .sendTransaction(
                            walletId, "eip155:" + chainId, b.build(), authorization, idempotencyKey)
                    .hash();
        } catch (Exception e) {
            throw failure(e);
        }
    }

    private static DmrvnException failure(Exception e) {
        if (e instanceof InterruptedException) {
            Thread.currentThread().interrupt();
            return new DmrvnException(DmrvnException.Code.INTERRUPTED);
        }
        if (e instanceof APIException a && (a.code() == 401 || a.code() == 403))
            return new DmrvnException(DmrvnException.Code.UNAUTHORIZED_SIGNER);
        return new DmrvnException(DmrvnException.Code.RPC_UNAVAILABLE);
    }
}
