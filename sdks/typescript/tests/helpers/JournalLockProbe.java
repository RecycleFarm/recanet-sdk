import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/** Offline interoperability probe, not SDK runtime code. */
class JournalLockProbe {
    public static void main(String[] args) throws Exception {
        try (var file = FileChannel.open(Path.of(args[0]), StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            if (args[1].equals("hold")) {
                try (var lock = file.lock()) {
                    System.out.println("LOCKED");
                    System.out.flush();
                    System.in.read();
                }
            } else {
                try (var lock = file.tryLock()) {
                    System.out.println(lock == null ? "BLOCKED" : "LOCKED");
                }
            }
        }
    }
}
