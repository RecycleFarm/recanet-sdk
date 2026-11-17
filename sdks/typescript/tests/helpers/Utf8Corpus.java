import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Independent Java UTF-8 replacement oracle; deterministic public byte corpus. */
class Utf8Corpus {
    static MessageDigest hash;
    static int cases = 0;
    static void add(byte[] bytes) {
        var text = new String(bytes, StandardCharsets.UTF_8);
        hash.update((byte)text.length());
        for (int i = 0; i < text.length(); i++) {
            int unit = text.charAt(i);
            hash.update((byte)unit); hash.update((byte)(unit >>> 8));
        }
        cases++;
    }
    public static void main(String[] args) throws Exception {
        hash = MessageDigest.getInstance("SHA-256");
        for (int a = 0; a < 256; a++) add(new byte[]{(byte)a});
        for (int a = 0; a < 256; a++) for (int b = 0; b < 256; b++) add(new byte[]{(byte)a, (byte)b});
        for (int a = 0xe0; a <= 0xef; a++) for (int b = 0; b < 256; b++) for (int c = 0; c < 256; c++)
            add(new byte[]{(byte)a, (byte)b, (byte)c});
        int[] edges = {0, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xed, 0xf4, 0xff};
        for (int a = 0xf0; a <= 0xf7; a++) for (int b : edges) for (int c : edges) for (int d : edges)
            add(new byte[]{(byte)a, (byte)b, (byte)c, (byte)d});
        long state = 0x12345678L;
        for (int i = 0; i < 65536; i++) {
            byte[] bytes = new byte[i % 8 + 1];
            for (int j = 0; j < bytes.length; j++) {
                state = (state * 1664525L + 1013904223L) & 0xffffffffL;
                bytes[j] = (byte)(state >>> 24);
            }
            add(bytes);
        }
        System.out.println("{\"source\":\"Actual Java17 String(bytes,UTF_8); deterministic offline corpus\","
            + "\"cases\":" + cases + ",\"sha256\":\"" + HexFormat.of().formatHex(hash.digest()) + "\"}");
    }
}
