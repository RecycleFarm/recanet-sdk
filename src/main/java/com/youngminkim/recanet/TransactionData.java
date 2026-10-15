package com.youngminkim.recanet;

import java.math.BigInteger;
import java.util.*;

/** Internal validation of untrusted RPC data. */
final class TransactionData {
    private TransactionData() {}

    static void require(boolean condition) {
        if (!condition) throw new TransactionQueryException(TransactionQueryException.Code.INVALID_RESPONSE);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object value) {
        require(value instanceof Map<?, ?>);
        var map = (Map<?, ?>) value;
        require(map.keySet().stream().allMatch(String.class::isInstance));
        return (Map<String, Object>) map;
    }

    static List<?> list(Object value) {
        require(value instanceof List<?>);
        return (List<?>) value;
    }

    static String hex(Object value, int bytes) {
        require(value instanceof String s && s.matches("0x[0-9a-fA-F]{" + bytes * 2 + "}"));
        return ((String) value).toLowerCase(Locale.ROOT);
    }

    static String input(Object value) {
        require(value instanceof String s && s.matches("0x(?:[0-9a-fA-F]{2})*"));
        return (String) value;
    }

    static BigInteger quantity(Object value) {
        require(value instanceof String s && s.matches("0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})"));
        return new BigInteger(((String) value).substring(2), 16);
    }

    static BigInteger optionalQuantity(Object value) { return value == null ? null : quantity(value); }

    static long height(Object value) {
        try { return quantity(value).longValueExact(); }
        catch (ArithmeticException e) {
            throw new TransactionQueryException(TransactionQueryException.Code.INVALID_RESPONSE);
        }
    }

    static int index(Object value) {
        try { return quantity(value).intValueExact(); }
        catch (ArithmeticException e) {
            throw new TransactionQueryException(TransactionQueryException.Code.INVALID_RESPONSE);
        }
    }

    static Map<String, Object> freezeMap(Map<String, Object> value) {
        var copy = new LinkedHashMap<String, Object>();
        value.forEach((k, v) -> copy.put(k, freeze(v)));
        return Collections.unmodifiableMap(copy);
    }

    private static Object freeze(Object value) {
        if (value instanceof Map<?, ?>) return freezeMap(map(value));
        if (value instanceof List<?> list) {
            var copy = new ArrayList<Object>();
            list.forEach(v -> copy.add(freeze(v)));
            return Collections.unmodifiableList(copy);
        }
        require(value == null || value instanceof String || value instanceof Number || value instanceof Boolean);
        return value;
    }
}
