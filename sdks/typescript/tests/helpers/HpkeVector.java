import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.bouncycastle.crypto.hpke.HPKE;
import org.bouncycastle.util.encoders.Hex;

/** Deterministic public test keys, no account or service connection. BC 1.83 only. */
class HpkeVector {
    public static void main(String[] args) throws Exception {
        var hpke = new HPKE(HPKE.mode_base, HPKE.kem_P256_SHA256, HPKE.kdf_HKDF_SHA256, HPKE.aead_CHACHA20_POLY1305);
        var ikmR = Hex.decode("00".repeat(32));
        var recipient = hpke.deriveKeyPair(ikmR);
        var ephemeral = hpke.deriveKeyPair(Hex.decode("01".repeat(32)));
        var sender = hpke.setupBaseS(recipient.getPublic(), new byte[0], ephemeral);
        var plaintext = "test-only export:한글🙂\n{not-parsed}".getBytes(StandardCharsets.UTF_8);
        var ciphertext = sender.seal(new byte[0], plaintext);
        var b64 = Base64.getEncoder();
        System.out.println("{\"source\":\"Bouncy Castle 1.83, fixed public test keys; offlineOnly\","
            + "\"kem\":16,\"kdf\":1,\"aead\":3,\"mode\":0,\"ikmR\":\"" + Hex.toHexString(ikmR) + "\","
            + "\"publicKeyR\":\"" + Hex.toHexString(hpke.serializePublicKey(recipient.getPublic())) + "\","
            + "\"encapsulatedKey\":\"" + b64.encodeToString(sender.getEncapsulation()) + "\","
            + "\"ciphertext\":\"" + b64.encodeToString(ciphertext) + "\","
            + "\"plaintextBase64\":\"" + b64.encodeToString(plaintext) + "\"}");
    }
}
