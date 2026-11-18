import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [platform, arch] of [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
  test(`installation rejects unsupported ${platform}/${arch} without compiling`, () => {
    const script = new URL('../scripts/install-native.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
      Object.defineProperty(process, 'arch', { value: ${JSON.stringify(arch)} });
      await import(${JSON.stringify(script)});
    `], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Recanet SDK supports linux\/x64 and darwin\/arm64/);
    assert.ok(result.stderr.includes(`received ${platform}/${arch}`));
  });
}
