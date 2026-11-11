package com.youngminkim.recanet.dmrvn;

import static com.youngminkim.recanet.dmrvn.DmrvnException.*;

import static java.nio.file.StandardOpenOption.*;

import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Single-host durable journal using OS locks, fsync and atomic replacement; not for NFS/distributed
 * hosts.
 */
public final class FileOperationJournal implements OperationJournal {
    private static final ConcurrentHashMap<Path, LockReference> LOCKS = new ConcurrentHashMap<>();

    private static final class LockReference {
        final ReentrantLock mutex = new ReentrantLock();
        int references;
    }

    private final Path root;
    private final ThreadLocal<Set<String>> held = ThreadLocal.withInitial(HashSet::new);

    public FileOperationJournal(Path directory) {
        try {
            Files.createDirectories(directory);
            root = directory.toRealPath();
            Files.setPosixFilePermissions(root, PosixFilePermissions.fromString("rwx------"));
        } catch (Exception e) {
            throw new DmrvnException(Code.JOURNAL_UNAVAILABLE);
        }
    }

    private String id(String key) {
        return Crypto.textHash(key).substring(2);
    }

    @Override
    public <T> T withLock(String key, Supplier<T> action) {
        String id = id(key);
        require(!held.get().contains(id), Code.JOURNAL_UNAVAILABLE);
        Path path = root.resolve(id + ".lock");
        var reference =
                LOCKS.compute(
                        path,
                        (p, existing) -> {
                            var ref = existing == null ? new LockReference() : existing;
                            ref.references++;
                            return ref;
                        });
        reference.mutex.lock();
        try (var channel = FileChannel.open(path, CREATE, WRITE);
                var lock = channel.lock()) {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
            held.get().add(id);
            try {
                return action.get();
            } finally {
                held.get().remove(id);
            }
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new DmrvnException(Code.JOURNAL_UNAVAILABLE);
        } finally {
            reference.mutex.unlock();
            LOCKS.compute(path, (p, ref) -> --ref.references == 0 ? null : ref);
        }
    }

    @Override
    public Map<String, Object> load(String key) {
        try {
            Path p = root.resolve(id(key) + ".json");
            return Files.exists(p) ? Json.object(Files.readAllBytes(p)) : null;
        } catch (Exception e) {
            throw new DmrvnException(Code.JOURNAL_UNAVAILABLE);
        }
    }

    @Override
    public List<Map<String, Object>> findOperationsByClaimId(String claimId) {
        String normalized = Crypto.bytes32(claimId, "claimId");
        require(held.get().contains(id("claim-id:" + normalized)), Code.JOURNAL_UNAVAILABLE);
        try (var files = Files.list(root)) {
            var records = new ArrayList<Map<String, Object>>();
            for (Path path :
                    files.filter(p -> p.getFileName().toString().matches("[0-9a-f]{64}\\.json"))
                            .toList()) {
                var value = Json.object(Files.readAllBytes(path));
                if (value.get("operationId") instanceof String operation
                        && path.getFileName()
                                .toString()
                                .equals(id("operation:" + operation) + ".json")
                        && normalized.equalsIgnoreCase(String.valueOf(value.get("claimId"))))
                    records.add(value);
            }
            return records;
        } catch (Exception e) {
            throw new DmrvnException(Code.JOURNAL_UNAVAILABLE);
        }
    }

    @Override
    public void store(String key, Map<String, Object> snapshot) {
        String id = id(key);
        require(held.get().contains(id), Code.JOURNAL_UNAVAILABLE);
        Path temp = null;
        try {
            byte[] bytes = Json.bytes(snapshot);
            temp =
                    Files.createTempFile(
                            root,
                            id,
                            ".tmp",
                            PosixFilePermissions.asFileAttribute(
                                    PosixFilePermissions.fromString("rw-------")));
            try (var out = FileChannel.open(temp, WRITE)) {
                var buffer = java.nio.ByteBuffer.wrap(bytes);
                while (buffer.hasRemaining()) out.write(buffer);
                out.force(true);
            }
            Files.move(
                    temp,
                    root.resolve(id + ".json"),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            try (var dir = FileChannel.open(root, READ)) {
                dir.force(true);
            }
        } catch (Exception e) {
            throw new DmrvnException(Code.JOURNAL_UNAVAILABLE);
        } finally {
            if (temp != null)
                try {
                    Files.deleteIfExists(temp);
                } catch (Exception ignored) {
                }
        }
    }
}
