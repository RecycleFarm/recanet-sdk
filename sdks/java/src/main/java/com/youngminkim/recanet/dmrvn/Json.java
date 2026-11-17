package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;

import java.math.BigInteger;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** JCS JSON; integers must be safe, decimals must round-trip without value loss. */
public final class Json {
    private static final ObjectMapper MAPPER =
            new ObjectMapper(
                    JsonFactory.builder()
                            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
                            .build())
                    .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final BigInteger MAX = BigInteger.valueOf(9007199254740991L);

    private Json() {}

    public static Object parse(byte[] bytes) {
        try {
            var decoder = StandardCharsets.UTF_8.newDecoder();
            String text = decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString();
            try (var tokens = MAPPER.createParser(text)) {
                while (tokens.nextToken() != null) {
                    require(
                            !tokens.currentToken().isNumeric() || !tokens.getText().equals("-0"),
                            Code.INVALID_INPUT);
                }
            }
            try (var parser = MAPPER.createParser(text)) {
                Object value = MAPPER.readValue(parser, Object.class);
                require(parser.nextToken() == null, Code.INVALID_INPUT);
                canonical(value);
                return value;
            }
        } catch (Exception e) {
            throw new DmrvnException(Code.INVALID_INPUT);
        }
    }

    public static Map<String, Object> object(byte[] bytes) {
        return map(parse(bytes));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) {
        require(o instanceof Map, Code.INVALID_INPUT);
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Object o) {
        require(o instanceof List, Code.INVALID_INPUT);
        return (List<Object>) o;
    }

    static String str(Object o) {
        require(o instanceof String, Code.INVALID_INPUT);
        return (String) o;
    }

    public static Map<String, Object> copy(Map<String, Object> o) {
        return object(bytes(o));
    }

    public static byte[] bytes(Object o) {
        return canonical(o).getBytes(StandardCharsets.UTF_8);
    }

    public static String hash(Object o) {
        return Crypto.hash(bytes(o));
    }

    public static String canonical(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean) return value.toString();
        if (value instanceof Byte
                || value instanceof Short
                || value instanceof Integer
                || value instanceof Long
                || value instanceof BigInteger) {
            require(new BigInteger(value.toString()).abs().compareTo(MAX) <= 0, Code.INVALID_INPUT);
            return value.toString();
        }
        if (value instanceof String s) {
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (Character.isHighSurrogate(c))
                    require(
                            ++i < s.length() && Character.isLowSurrogate(s.charAt(i)),
                            Code.INVALID_INPUT);
                else require(!Character.isLowSurrogate(c), Code.INVALID_INPUT);
            }
            try {
                return MAPPER.writeValueAsString(s);
            } catch (Exception e) {
                throw new DmrvnException(Code.INVALID_INPUT);
            }
        }
        if (value instanceof Double || value instanceof Float || value instanceof BigDecimal) {
            try {
                double number = Double.parseDouble(value.toString());
                require(Double.isFinite(number), Code.INVALID_INPUT);
                String encoded = org.erdtman.jcs.NumberToJSON.serializeNumber(number);
                require(new BigDecimal(value.toString()).compareTo(new BigDecimal(encoded)) == 0,
                        Code.INVALID_INPUT);
                return encoded;
            } catch (Exception e) {
                throw new DmrvnException(Code.INVALID_INPUT);
            }
        }
        if (value instanceof List<?> values)
            return "[" + String.join(",", values.stream().map(Json::canonical).toList()) + "]";
        if (value instanceof Map<?, ?> fields) {
            require(
                    fields.keySet().stream().allMatch(String.class::isInstance),
                    Code.INVALID_INPUT);
            return "{"
                    + String.join(
                            ",",
                            fields.keySet().stream()
                                    .map(String.class::cast)
                                    .sorted()
                                    .map(k -> canonical(k) + ":" + canonical(fields.get(k)))
                                    .toList())
                    + "}";
        }
        throw new DmrvnException(Code.INVALID_INPUT);
    }

    static Map<String, Object> obj(Object... kv) {
        var m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }
}
