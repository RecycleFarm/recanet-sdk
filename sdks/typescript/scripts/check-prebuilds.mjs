import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceSha256 = hash(await readFile(new URL('native/posix-lock.c', root)));
for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'arm64']]) {
  const directory = new URL(`prebuilds/${platform}-${arch}/`, root);
  const binary = await readFile(new URL('posix-lock.node', directory));
  const metadata = JSON.parse(await readFile(new URL('build.json', directory), 'utf8'));
  if (metadata.platform !== platform || metadata.arch !== arch || metadata.napi !== 8 ||
      metadata.sourceSha256 !== sourceSha256 || metadata.binarySha256 !== hash(binary)) {
    throw new Error(`Missing, stale or mismatched prebuild: ${platform}-${arch}`);
  }
  const correctHeader = platform === 'linux'
    ? binary.length >= 20 && binary.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) && binary.readUInt16LE(18) === 62
    : binary.length >= 8 && binary.readUInt32LE(0) === 0xfeedfacf && binary.readUInt32LE(4) === 0x0100000c;
  if (!correctHeader) throw new Error(`Wrong native binary architecture: ${platform}-${arch}`);
}
console.error('Verified Linux x64 and macOS ARM64 Node-API v8 prebuilds');
