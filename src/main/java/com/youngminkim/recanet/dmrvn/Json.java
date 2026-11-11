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
        require(bytes != null, Code.INVALID_INPUT, "json", "must not be null");
        try {
            var decoder = StandardCharsets.UTF_8.newDecoder();
            String text = decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString();
            try (var tokens = MAPPER.createParser(text)) {
                while (tokens.nextToken() != null) {
                    require(
                            !tokens.currentToken().isNumeric() || !tokens.getText().equals("-0"),
                            Code.INVALID_INPUT, "$" + tokens.getParsingContext().pathAsPointer(),
                            "numeric token -0 is not allowed");
                }
            }
            try (var parser = MAPPER.createParser(text)) {
                Object value = MAPPER.readValue(parser, Object.class);
                require(parser.nextToken() == null, Code.INVALID_INPUT,
                        "json", "must contain exactly one top-level JSON value");
                canonical(value);
                return value;
            }
        } catch (DmrvnException e) {
            throw e;
        } catch (java.nio.charset.CharacterCodingException e) {
            throw invalidInput("json", "must contain valid UTF-8");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            var location = e.getLocation();
            String position = location == null ? "" : " at line " + location.getLineNr()
                    + ", column " + location.getColumnNr();
            String field = "json";
            if (e.getProcessor() instanceof com.fasterxml.jackson.core.JsonParser parser)
                field = "$" + parser.getParsingContext().pathAsPointer();
            String reason = e.getOriginalMessage().startsWith("Duplicate field")
                    ? "must not contain duplicate object keys" : "must contain valid JSON";
            throw invalidInput(field, reason + position);
        } catch (Exception e) {
            throw invalidInput("json", "must contain valid JSON");
        }
    }

    public static Map<String, Object> object(byte[] bytes) {
        return map(parse(bytes));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) {
        require(o instanceof Map, Code.INVALID_INPUT, "value", "must be a JSON object");
        return (Map<String, Object>) o;
    }

    @SuppressWarnings("unchecked")
    static List<Object> list(Object o) {
        require(o instanceof List, Code.INVALID_INPUT, "value", "must be a JSON array");
        return (List<Object>) o;
    }

    static String str(Object o) {
        require(o instanceof String, Code.INVALID_INPUT, "value", "must be a string");
        return (String) o;
    }

    public static Map<String, Object> copy(Map<String, Object> o) {
        return object(bytes(o));
    }

    static Map<String, Object> copy(Map<String, Object> value, String field) {
        return input(field, () -> copy(value));
    }

    static Map<String, Object> map(Object value, String field) {
        return input(field, () -> map(value));
    }

    static List<Object> list(Object value, String field) {
        return input(field, () -> list(value));
    }

    static String str(Object value, String field) {
        return input(field, () -> str(value));
    }

    public static byte[] bytes(Object o) {
        return canonical(o).getBytes(StandardCharsets.UTF_8);
    }

    public static String hash(Object o) {
        return Crypto.hash(bytes(o));
    }

    public static String canonical(Object value) {
        return canonical(value, "$");
    }

    private static String canonical(Object value, String path) {
        if (value == null) return "null";
        if (value instanceof Boolean) return value.toString();
        if (value instanceof Byte
                || value instanceof Short
                || value instanceof Integer
                || value instanceof Long
                || value instanceof BigInteger) {
            require(new BigInteger(value.toString()).abs().compareTo(MAX) <= 0, Code.INVALID_INPUT,
                    path, "integer must be within the safe range -9007199254740991 to 9007199254740991");
            return value.toString();
        }
        if (value instanceof String s) {
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (Character.isHighSurrogate(c))
                    require(
                            ++i < s.length() && Character.isLowSurrogate(s.charAt(i)),
                            Code.INVALID_INPUT, path, "string must not contain an unpaired Unicode surrogate");
                else require(!Character.isLowSurrogate(c), Code.INVALID_INPUT,
                        path, "string must not contain an unpaired Unicode surrogate");
            }
            try {
                return MAPPER.writeValueAsString(s);
            } catch (Exception e) {
                throw invalidInput(path, "string could not be serialized as JSON");
            }
        }
        if (value instanceof Double || value instanceof Float || value instanceof BigDecimal) {
            try {
                double number = Double.parseDouble(value.toString());
                require(Double.isFinite(number), Code.INVALID_INPUT,
                        path, "number must be finite; NaN and Infinity are not allowed");
                String encoded = org.erdtman.jcs.NumberToJSON.serializeNumber(number);
                require(new BigDecimal(value.toString()).compareTo(new BigDecimal(encoded)) == 0,
                        Code.INVALID_INPUT, path, "decimal must round-trip through JCS without value loss");
                return encoded;
            } catch (DmrvnException e) {
                throw e;
            } catch (Exception e) {
                throw invalidInput(path, "number could not be serialized using JCS");
            }
        }
        if (value instanceof List<?> values) {
            var encoded = new ArrayList<String>();
            for (int i = 0; i < values.size(); i++)
                encoded.add(canonical(values.get(i), path + "[" + i + "]"));
            return "[" + String.join(",", encoded) + "]";
        }
        if (value instanceof Map<?, ?> fields) {
            require(
                    fields.keySet().stream().allMatch(String.class::isInstance),
                    Code.INVALID_INPUT, path, "object keys must be strings");
            return "{"
                    + String.join(
                            ",",
                            fields.keySet().stream()
                                    .map(String.class::cast)
                                    .sorted()
                                    .map(k -> canonical(k, path + " (object key)") + ":"
                                            + canonical(fields.get(k), path + "." + k))
                                    .toList())
                    + "}";
        }
        throw invalidInput(path, "must be a supported JSON value (object, array, string, boolean, number or null)");
    }

    static Map<String, Object> obj(Object... kv) {
        var m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }
}
