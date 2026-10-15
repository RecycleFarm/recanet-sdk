package com.youngminkim.recanet.dmrvn;

import java.util.List;

/** JSON-RPC transport seam for deterministic tests and application transports. */
@FunctionalInterface
public interface EvmRpc {
    Object call(String method, List<Object> params);
}
