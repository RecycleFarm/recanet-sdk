package com.youngminkim.recanet.dmrvn;

/**
 * Explicit partner integration boundary. Implementations verify partner credentials and scope,
 * authorize this member's wallet use, then look up or create the member wallet. Returned signers
 * must recheck authorization before signing, including revocation. A member ID is not credentials.
 * Mapping and authorization policy are supplied by the integrator, not inferred by DMRVN.
 */
@FunctionalInterface
public interface BeneficiaryWallets {
    EvmSigner getOrCreateSigner(long partnerId, String userId);
}
