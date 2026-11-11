package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import org.bouncycastle.crypto.digests.KeccakDigest;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.math.ec.ECAlgorithms;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class Crypto {
    static final String ZERO = "0x" + "00".repeat(32);

    static byte[] hex(String s) {
        require(s != null && s.matches("0x([0-9a-fA-F]{2})*"), Code.INVALID_INPUT,
                "value", "must be a 0x-prefixed hexadecimal string with an even number of digits");
        return HexFormat.of().parseHex(s.substring(2));
    }

    static String hex(byte[] b) {
        return "0x" + HexFormat.of().formatHex(b);
    }

    static byte[] join(byte[]... values) {
        var out = new java.io.ByteArrayOutputStream();
        for (var b : values) out.writeBytes(b);
        return out.toByteArray();
    }

    static String hash(byte[] b) {
        var d = new KeccakDigest(256);
        d.update(b, 0, b.length);
        byte[] out = new byte[32];
        d.doFinal(out, 0);
        return hex(out);
    }

    static String textHash(String s) {
        return hash(s.getBytes(StandardCharsets.UTF_8));
    }

    static String address(String s) {
        require(s != null && s.matches("0x[0-9a-fA-F]{40}"), Code.INVALID_INPUT,
                "value", "must be a 0x-prefixed 20-byte address");
        String lower = s.substring(2).toLowerCase(Locale.ROOT);
        if (!s.substring(2).equals(lower)
                && !s.substring(2).equals(s.substring(2).toUpperCase(Locale.ROOT))) {
            String h = textHash(lower).substring(2);
            for (int i = 0; i < 40; i++)
                if (Character.isLetter(lower.charAt(i)))
                    require(
                            s.charAt(i + 2)
                                    == (Character.digit(h.charAt(i), 16) >= 8
                                            ? Character.toUpperCase(lower.charAt(i))
                                            : lower.charAt(i)),
                            Code.INVALID_INPUT, "value", "mixed-case address must have a valid EIP-55 checksum");
        }
        return "0x" + lower;
    }

    static String bytes32(String s) {
        require(hex(s).length == 32, Code.INVALID_INPUT, "value", "must contain exactly 32 bytes");
        return s.toLowerCase(Locale.ROOT);
    }

    static String address(String value, String field) {
        return input(field, () -> address(value));
    }

    static String bytes32(String value, String field) {
        return input(field, () -> bytes32(value));
    }

    static BigInteger uint(Object value, int bits, String field) {
        return input(field, () -> uint(value, bits));
    }

    static BigInteger uint(Object o, int bits) {
        require(
                o instanceof String
                        || o instanceof Byte
                        || o instanceof Short
                        || o instanceof Integer
                        || o instanceof Long
                        || o instanceof BigInteger,
                Code.INVALID_INPUT, "value", "must be an integer or an unsigned decimal integer string");
        String s = o.toString();
        require(s.matches("0|[1-9][0-9]*"), Code.INVALID_INPUT,
                "value", "must be a non-negative decimal integer without leading zeros");
        BigInteger n = new BigInteger(s);
        require(n.bitLength() <= bits, Code.INVALID_INPUT, "value", "must fit in uint" + bits);
        return n;
    }

    static byte[] word(BigInteger n) {
        require(n.signum() >= 0 && n.bitLength() <= 256, Code.INVALID_INPUT,
                "value", "must be a non-negative integer that fits in uint256");
        byte[] raw = n.toByteArray(), out = new byte[32];
        int size = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - size, out, 32 - size, size);
        return out;
    }

    static String recover(String digest, String signature) {
        try {
            byte[] sig = hex(signature);
            require(sig.length == 65, Code.SIGNATURE_INVALID);
            int v = Byte.toUnsignedInt(sig[64]);
            if (v >= 27) v -= 27;
            require(v == 0 || v == 1, Code.SIGNATURE_INVALID);
            var curve = CustomNamedCurves.getByName("secp256k1");
            var n = curve.getN();
            BigInteger r = new BigInteger(1, Arrays.copyOfRange(sig, 0, 32)),
                    s = new BigInteger(1, Arrays.copyOfRange(sig, 32, 64));
            require(
                    r.signum() > 0
                            && r.compareTo(n) < 0
                            && s.signum() > 0
                            && s.compareTo(n.shiftRight(1)) <= 0,
                    Code.SIGNATURE_INVALID);
            byte[] compressed = join(new byte[] {(byte) (2 + v)}, word(r));
            var R = curve.getCurve().decodePoint(compressed);
            require(R.multiply(n).isInfinity(), Code.SIGNATURE_INVALID);
            var inv = r.modInverse(n);
            var e = new BigInteger(1, hex(bytes32(digest)));
            var q =
                    ECAlgorithms.sumOfTwoMultiplies(
                                    curve.getG(),
                                    e.negate().mod(n).multiply(inv).mod(n),
                                    R,
                                    s.multiply(inv).mod(n))
                            .normalize();
            byte[] pub = q.getEncoded(false);
            return "0x" + hash(Arrays.copyOfRange(pub, 1, pub.length)).substring(26);
        } catch (Exception e) {
            throw new DmrvnException(Code.SIGNATURE_INVALID);
        }
    }

    static String messageDigest(String text) {
        byte[] b = text.getBytes(StandardCharsets.UTF_8);
        return hash(
                join(
                        ("\u0019Ethereum Signed Message:\n" + b.length)
                                .getBytes(StandardCharsets.UTF_8),
                        b));
    }
}
