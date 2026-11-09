import { DeclaredMethodology, DmrvnCrypto, DmrvnJson } from '../../dist/index.js';

/** 합성 빈 WASM/manifest. 실제 PET v3 배포·승인 패키지로 사용하지 않는다. */
export function petV3Methodology(registry = () => true, changes = {}) {
  const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const manifest = { activityId: 1003, methodology: { id: 2003, version: 3 },
    wasmHash: DmrvnCrypto.keccak(wasm), ...changes };
  const bytes = DmrvnJson.bytes(manifest), hash = DmrvnJson.hash(manifest);
  return { wasm, manifest, bytes, hash, methodology: DeclaredMethodology.petV3(bytes, wasm, hash, registry) };
}
