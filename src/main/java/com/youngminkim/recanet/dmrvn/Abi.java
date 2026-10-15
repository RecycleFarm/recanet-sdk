package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Internal ABI codec restricted to the supplied v7/Forwarder ABI types. */
final class Abi {
    record Field(String name, String type, List<Field> children) {
        boolean dynamic() {
            return type.equals("tuple")
                    ? children.stream().anyMatch(Field::dynamic)
                    : type.endsWith("[]") || type.equals("string") || type.equals("bytes");
        }

        int size() {
            return dynamic()
                    ? 32
                    : type.equals("tuple") ? children.stream().mapToInt(Field::size).sum() : 32;
        }

        String signature() {
            return type.equals("tuple")
                    ? "(" + String.join(",", children.stream().map(Field::signature).toList()) + ")"
                    : type;
        }

        Field element() {
            return new Field("", type.substring(0, type.length() - 2), children);
        }
    }

    private final List<Map<String, Object>> definitions;

    Abi(String resource) {
        try (var stream = Abi.class.getResourceAsStream("/dmrvn/" + resource)) {
            definitions =
                    Json.list(Json.parse(Objects.requireNonNull(stream).readAllBytes())).stream()
                            .map(Json::map)
                            .toList();
        } catch (Exception e) {
            throw new IllegalStateException("Missing ABI resource", e);
        }
    }

    Map<String, Object> definition(String name) {
        return definitions.stream()
                .filter(d -> name.equals(d.get("name")))
                .findFirst()
                .orElseThrow();
    }

    List<Field> inputs(String name) {
        return fields(Json.list(definition(name).get("inputs")));
    }

    List<Field> outputs(String name) {
        return fields(Json.list(definition(name).get("outputs")));
    }

    static List<Field> fields(List<Object> values) {
        return values.stream()
                .map(Json::map)
                .map(
                        v ->
                                new Field(
                                        Json.str(v.get("name")),
                                        Json.str(v.get("type")),
                                        v.containsKey("components")
                                                ? fields(Json.list(v.get("components")))
                                                : List.of()))
                .toList();
    }

    String signature(String name) {
        return name
                + "("
                + String.join(",", inputs(name).stream().map(Field::signature).toList())
                + ")";
    }

    String topic(String name) {
        return Crypto.textHash(signature(name));
    }

    String encode(String name, Map<String, Object> values) {
        return topic(name).substring(0, 10) + Crypto.hex(tuple(inputs(name), values)).substring(2);
    }

    Map<String, Object> decodeCall(String name, String data) {
        require(
                data.length() >= 10
                        && data.substring(0, 10).equalsIgnoreCase(topic(name).substring(0, 10)),
                Code.INVALID_INPUT);
        var decoded = decode(inputs(name), Crypto.hex("0x" + data.substring(10)), 0);
        require(encode(name, decoded).equalsIgnoreCase(data), Code.INVALID_INPUT);
        return decoded;
    }

    Map<String, Object> decodeOutput(String name, String data) {
        return decode(outputs(name), Crypto.hex(data), 0);
    }

    Map<String, Object> decodeEvent(String name, Map<String, Object> log) {
        List<Object> topics = Json.list(log.get("topics"));
        require(
                !topics.isEmpty() && topic(name).equalsIgnoreCase(Json.str(topics.get(0))),
                Code.INVALID_INPUT);
        List<Field> normal = new ArrayList<>();
        var out = new LinkedHashMap<String, Object>();
        int i = 1;
        for (var d : Json.list(definition(name).get("inputs"))) {
            var m = Json.map(d);
            Field f = fields(List.of(d)).get(0);
            if (Boolean.TRUE.equals(m.get("indexed"))) {
                require(i < topics.size(), Code.INVALID_INPUT);
                out.put(f.name(), read(f, Crypto.hex(Json.str(topics.get(i++))), 0));
            } else normal.add(f);
        }
        require(i == topics.size(), Code.INVALID_INPUT);
        out.putAll(decode(normal, Crypto.hex(Json.str(log.get("data"))), 0));
        return out;
    }

    static byte[] tuple(List<Field> fields, Map<String, Object> values) {
        return sequence(
                fields,
                fields.stream()
                        .map(
                                f -> {
                                    require(values.containsKey(f.name), Code.INVALID_INPUT);
                                    return values.get(f.name);
                                })
                        .toList());
    }

    private static byte[] sequence(List<Field> fields, List<Object> values) {
        var head = new java.io.ByteArrayOutputStream();
        var tail = new java.io.ByteArrayOutputStream();
        int headSize = fields.stream().mapToInt(Field::size).sum();
        for (int i = 0; i < fields.size(); i++) {
            Field f = fields.get(i);
            byte[] encoded = write(f, values.get(i));
            if (f.dynamic()) {
                head.writeBytes(Crypto.word(BigInteger.valueOf(headSize + tail.size())));
                tail.writeBytes(encoded);
            } else head.writeBytes(encoded);
        }
        return Crypto.join(head.toByteArray(), tail.toByteArray());
    }

    private static byte[] write(Field f, Object v) {
        String t = f.type;
        if (t.equals("tuple")) return tuple(f.children, Json.map(v));
        if (t.endsWith("[]")) {
            var list = Json.list(v);
            require(list.size() <= 1024, Code.INVALID_INPUT);
            return Crypto.join(
                    Crypto.word(BigInteger.valueOf(list.size())),
                    sequence(Collections.nCopies(list.size(), f.element()), list));
        }
        if (t.equals("string") || t.equals("bytes")) {
            byte[] b =
                    t.equals("string")
                            ? Json.str(v).getBytes(StandardCharsets.UTF_8)
                            : Crypto.hex(Json.str(v));
            return Crypto.join(
                    Crypto.word(BigInteger.valueOf(b.length)),
                    Arrays.copyOf(b, ((b.length + 31) / 32) * 32));
        }
        if (t.equals("bytes32")) return Crypto.hex(Crypto.bytes32(Json.str(v)));
        if (t.equals("bytes1")) {
            byte[] value = Crypto.hex(Json.str(v));
            require(value.length == 1, Code.INVALID_INPUT);
            return Arrays.copyOf(value, 32);
        }
        if (t.equals("address"))
            return Crypto.word(new BigInteger(Crypto.address(Json.str(v)).substring(2), 16));
        if (t.equals("bool")) {
            require(v instanceof Boolean, Code.INVALID_INPUT);
            return Crypto.word(Boolean.TRUE.equals(v) ? BigInteger.ONE : BigInteger.ZERO);
        }
        if (t.startsWith("uint"))
            return Crypto.word(Crypto.uint(v, Integer.parseInt(t.substring(4))));
        throw new IllegalArgumentException("Unsupported ABI type");
    }

    static Map<String, Object> decode(List<Field> fields, byte[] data, int start) {
        var result = new LinkedHashMap<String, Object>();
        int cursor = start;
        for (Field f : fields) {
            int location = f.dynamic() ? Math.addExact(start, offset(data, cursor)) : cursor;
            result.put(f.name, read(f, data, location));
            cursor = Math.addExact(cursor, f.size());
        }
        return result;
    }

    private static int offset(byte[] b, int i) {
        int n = new BigInteger(1, slice(b, i, 32)).intValueExact();
        require(n >= 0, Code.INVALID_INPUT);
        return n;
    }

    private static byte[] slice(byte[] b, int start, int len) {
        require(start >= 0 && len >= 0 && start <= b.length - len, Code.INVALID_INPUT);
        return Arrays.copyOfRange(b, start, start + len);
    }

    private static Object read(Field f, byte[] b, int start) {
        String t = f.type;
        if (t.equals("bytes1")) {
            byte[] word = slice(b, start, 32);
            for (int i = 1; i < word.length; i++) require(word[i] == 0, Code.INVALID_INPUT);
            return Crypto.hex(new byte[] {word[0]});
        }
        if (t.equals("tuple")) return decode(f.children, b, start);
        if (t.endsWith("[]")) {
            int count = offset(b, start);
            require(count <= 1024, Code.INVALID_INPUT);
            var fields = new ArrayList<Field>();
            for (int i = 0; i < count; i++)
                fields.add(new Field(Integer.toString(i), f.element().type, f.children));
            return new ArrayList<>(decode(fields, b, start + 32).values());
        }
        if (t.equals("string") || t.equals("bytes")) {
            byte[] raw = slice(b, start + 32, offset(b, start));
            if (t.equals("bytes")) return Crypto.hex(raw);
            try {
                return StandardCharsets.UTF_8
                        .newDecoder()
                        .decode(java.nio.ByteBuffer.wrap(raw))
                        .toString();
            } catch (Exception e) {
                throw new DmrvnException(Code.INVALID_INPUT);
            }
        }
        byte[] word = slice(b, start, 32);
        BigInteger n = new BigInteger(1, word);
        if (t.equals("bytes32")) return Crypto.hex(word);
        if (t.equals("address")) {
            require(n.bitLength() <= 160, Code.INVALID_INPUT);
            return Crypto.hex(Arrays.copyOfRange(word, 12, 32));
        }
        if (t.equals("bool")) {
            require(n.bitLength() <= 1, Code.INVALID_INPUT);
            return n.equals(BigInteger.ONE);
        }
        if (t.startsWith("uint")) {
            int bits = Integer.parseInt(t.substring(4));
            require(n.bitLength() <= bits, Code.INVALID_INPUT);
            return bits <= 32 ? n.longValueExact() : n.toString();
        }
        throw new IllegalArgumentException("Unsupported ABI type");
    }
}
