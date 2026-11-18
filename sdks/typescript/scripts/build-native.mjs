import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!['darwin', 'linux'].includes(process.platform)) {
  process.stderr.write('FileOperationJournal native locks require macOS or Linux; building the remaining SDK.\n');
  process.exit(0);
}
const candidates = [process.env.RECANET_NODE_INCLUDE, join(dirname(process.execPath), '../include/node'),
  join(homedir(), 'Library/Caches/node-gyp', process.versions.node, 'include/node'),
  join(homedir(), '.cache/node-gyp', process.versions.node, 'include/node'), '/usr/include/node', '/usr/local/include/node'];
let include;
for (const candidate of candidates.filter(Boolean)) {
  try { await access(join(candidate, 'node_api.h')); include = resolve(candidate); break; } catch {}
}
if (!include) throw new Error('Node-API headers not found; set RECANET_NODE_INCLUDE to the directory containing node_api.h');
const output = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'posix-lock.node');
const temp = output + '.' + process.pid + '.tmp';
await mkdir(dirname(output), { recursive: true });
try {
  const flags = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC'];
  const result = spawnSync(process.env.CC || 'cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', ...flags,
    '-I', include, '-o', temp, join(root, 'native/posix-lock.c')], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Native journal lock build failed');
  await rename(temp, output);
  const sourceSha256 = createHash('sha256').update(await readFile(join(root, 'native/posix-lock.c'))).digest('hex');
  await writeFile(join(dirname(output), 'build.json'), JSON.stringify({
    platform: process.platform, arch: process.arch, napi: 8, sourceSha256,
    binarySha256: createHash('sha256').update(await readFile(output)).digest('hex'),
  }, null, 2) + '\n');
} finally { await rm(temp, { force: true }); }
