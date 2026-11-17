import { parentPort, workerData } from 'node:worker_threads';
import { open } from 'node:fs/promises';
import { nativeLocks } from '../../dist/internal/posix-lock.js';
const handle = await open(workerData, 'a', 0o600);
try { parentPort.postMessage(nativeLocks().tryLock(handle.fd)); }
finally { await handle.close(); }
