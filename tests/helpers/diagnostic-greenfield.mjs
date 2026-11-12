import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeGreenfieldStorage } from '../../dist/index.js';

export async function diagnosticGreenfieldFixture(t, address) {
  const directory = await mkdtemp(join(tmpdir(), 'recanet-diagnostic-storage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = 'RECANET_DIAGNOSTIC_TEST_STORAGE_KEY', previous = process.env[key];
  process.env[key] = 'test-only-placeholder';
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  const workerPath = join(directory, 'worker.mjs');
  await writeFile(workerPath, `
    import fs from 'node:fs/promises';
    let input = ''; for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input), file = name => new URL('./' + name, import.meta.url);
    await fs.appendFile(file('requests.jsonl'), JSON.stringify(request) + '\\n');
    const exists = await fs.access(file('bytes')).then(() => true, () => false);
    const sealed = await fs.access(file('sealed')).then(() => true, () => false);
    let data = {};
    if (request.op === 'head') data = { exists, sealed };
    if (request.op === 'create') { await fs.writeFile(file('bytes'), request.bytes); data = { createTxHash: 'mock-create-hash' }; }
    if (request.op === 'upload') await fs.writeFile(file('sealed'), 'true');
    if (request.op === 'read') data = { bytes: await fs.readFile(file('bytes'), 'utf8') };
    process.stdout.write(JSON.stringify({ ok: true, data }));
  `);
  const storage = new NodeGreenfieldStorage({ rpcUrl: 'https://storage.invalid', chainId: '5600', address,
    keyEnvironmentVariable: key, workerPath, timeoutMs: 3000 });
  const requests = async () => (await readFile(join(directory, 'requests.jsonl'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  })).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { storage, requests };
}
