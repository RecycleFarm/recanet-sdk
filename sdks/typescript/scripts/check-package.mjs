import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'recanet-package-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cache = process.env.RECANET_NPM_CACHE ? ['--cache', process.env.RECANET_NPM_CACHE] : [];
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.stdout + result.stderr || 'Package verification command failed');
  return result.stdout;
}
try {
  const packed = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', directory, ...cache], root))[0];
  const files = new Set(packed.files.map(file => file.path));
  for (const file of files) {
    if (file.startsWith('docs/') || file.endsWith('.map') || file.endsWith('-sources.jar')) {
      throw new Error('Private/development content in package: ' + file);
    }
  }
  for (const path of ['dist/index.js', 'dist/index.d.ts', 'dist/resources/dmrvn/dmrvn-claim-v7.json',
    'native/posix-lock.c', 'scripts/build-native.mjs', 'tools/greenfield/worker.cjs', 'tools/greenfield/package-lock.json',
    'tools/greenfield/vendor/elliptic/LICENSE', 'tools/greenfield/vendor/elliptic/lib/elliptic/ec/index.js',
    'tools/greenfield/vendor/safe-set/index.cjs', 'THIRD_PARTY_NOTICES']) {
    if (!files.has(path)) throw new Error('Missing package file: ' + path);
  }
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: {
    '@recyclefarm/recanet-sdk': 'file:' + join(directory, packed.filename), typescript: '6.0.3', '@types/node': '22.20.5',
  } }));
  const offline = process.env.RECANET_PACKAGE_OFFLINE === '1' ? ['--offline'] : [];
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...offline, ...cache], directory);
  const installed = join(directory, 'node_modules/@recyclefarm/recanet-sdk');
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const markdown = await readFile(join(installed, file), 'utf8');
    for (const [, link] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#')) continue;
      const target = link.split('#')[0];
      if (!target) continue;
      const path = resolve(installed, dirname(file), decodeURIComponent(target));
      if (!path.startsWith(installed + sep)) throw new Error('Package documentation link escapes package: ' + file);
      await access(path);
    }
  }
  run(npm, ['ci', '--prefix', join(installed, 'tools/greenfield'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...cache], directory);
  await writeFile(join(directory, 'consumer.ts'), await readFile(new URL('../tests/fixtures/package-consumer.ts', import.meta.url)));
  run(process.execPath, [join(directory, 'node_modules/typescript/bin/tsc'), '--module', 'NodeNext', '--target', 'ES2022',
    '--lib', 'ES2022', '--types', 'node', '--strict', 'consumer.ts'], directory);
  const output = run(process.execPath, ['consumer.js'], directory);
  process.stdout.write(output);
  process.stdout.write(JSON.stringify({ files: packed.entryCount, bytes: packed.size, integrity: packed.integrity }) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
