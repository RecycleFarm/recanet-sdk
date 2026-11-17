import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
const java=require('../../../sdks/java/tools/greenfield/worker.cjs');
const ts=require('../../../sdks/typescript/tools/greenfield/worker.cjs');
const javaBytes=await readFile(new URL('../../../sdks/java/tools/greenfield/worker.cjs',import.meta.url));
const tsBytes=await readFile(new URL('../../../sdks/typescript/tools/greenfield/worker.cjs',import.meta.url));
assert.deepEqual(javaBytes,tsBytes,'Greenfield worker implementations differ');
let count=0;
for(const text of['한글/원본.json','😀/space value','a/../b']) {
  const raw=Buffer.from(JSON.stringify({location:{objectName:text}}));
  for(let boundary=0;boundary<=raw.length;boundary++) {
    const chunks=[raw.subarray(0,boundary),raw.subarray(boundary)];
    const j=await java.readRequest(Readable.from(chunks)),t=await ts.readRequest(Readable.from(chunks));
    assert.deepEqual(j,t);assert.equal(j.location.objectName,text);count++;
  }
}
console.log(`PASS identical Greenfield workers and ${count} split UTF-8 inputs`);
