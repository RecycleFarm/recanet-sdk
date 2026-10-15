'use strict';
// Executes the supplied approved WASM only as an offline test oracle. Production SDK never computes outputs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ethers } = require('ethers');
(async () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../../src/test/resources/dmrvn/pet-methodology.wasm'));
  assert.equal(ethers.utils.keccak256(bytes), '0x60265f20ca003ae4b20f0bca18f73d0d4e9bb7c9497627d7f680113dac4c91d9');
  const { instance } = await WebAssembly.instantiate(bytes);
  for (const [input, expected] of [[1,20],[3,60],[100000,2000000]]) assert.equal(instance.exports.compute(input),expected);
  process.stdout.write('PASS approved PET WASM: 1 -> 20, 3 -> 60, 100000 -> 2000000 gCO2e\n');
})();
