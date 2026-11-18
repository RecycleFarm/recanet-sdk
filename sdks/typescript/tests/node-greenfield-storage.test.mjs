import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DmrvnError, NodeGreenfieldStorage } from '../dist/index.js';



const keyEnv = 'RECANET_TEST_STORAGE_KEY', secret = 'test-only-storage-key';
const location = { storageType: 1, chainId: '5600', bucketName: 'private', objectName: 'evidence.json' };
const common = "import fs from 'node:fs/promises';\nlet wire=''; for await(const chunk of process.stdin) wire+=chunk;\nconst request=JSON.parse(wire);\n";
async function fixture(t, body) {
  const dir = await mkdtemp(join(tmpdir(), 'recanet-storage-worker-')), workerPath = join(dir, 'worker.mjs');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = process.env[keyEnv]; process.env[keyEnv] = secret;
  t.after(() => { if (before === undefined) delete process.env[keyEnv]; else process.env[keyEnv] = before; });
  await writeFile(workerPath, common + body);
  const options = { rpcUrl: 'https://greenfield.invalid', chainId: '5600', address: '0x' + 'ab'.repeat(20),
    keyEnvironmentVariable: keyEnv, nodePath: process.execPath, workerPath, timeoutMs: 3000 };
  return { dir, workerPath, options, storage: new NodeGreenfieldStorage(options) };
}
const rejects = (fn, code) => assert.rejects(fn, error => error instanceof DmrvnError && error.code === code);

test('worker에는 저장소 전용 환경만 전달하고 wire/argv에 키를 넣지 않으며 다섯 op의 원래 입력을 보존한다', async t => {
  const parentEnv = 'RECANET_TEST_PARENT_PRIVY'; process.env[parentEnv] = 'test-only-parent-secret';
  t.after(() => { delete process.env[parentEnv]; });
  const body = [
    "if(process.env.GREENFIELD_STORAGE_PRIVATE_KEY!=='test-only-storage-key' || process.env.RECANET_TEST_PARENT_PRIVY || process.env.HOME || process.env.PATH",
    " || wire.includes('test-only-storage-key') || process.argv.some(x=>x.includes('test-only-storage-key'))) throw Error('bad boundary');",
    "await fs.appendFile(new URL('./requests.jsonl',import.meta.url), JSON.stringify(request)+'\\n');",
    "process.stderr.write('provider-secret deliberately discarded');",
    "const data=request.op==='head'?{exists:true,sealed:false}:request.op==='create'?{createTxHash:'abc-original'}:",
    " request.op==='read'?{bytes:'AP8BYQ=='}:request.op==='verifyCreate'?{matches:true}:{};",
    "process.stdout.write(JSON.stringify({ok:true,data}));",
  ].join('\n');
  const f = await fixture(t, body), bytes = new Uint8Array([0, 255, 1, 97]);
  assert.deepEqual(await f.storage.head(location), { exists: true, sealed: false });
  assert.equal(await f.storage.create(location, bytes), 'abc-original');
  await f.storage.upload(location, bytes, 'abc-original'); assert.deepEqual([...await f.storage.read(location)], [...bytes]);
  assert.equal(await f.storage.matchesCreateTransaction(location, 'abc-original'), true);
  const requests = (await readFile(join(f.dir, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(r => r.op), ['head', 'create', 'upload', 'read', 'verifyCreate']);
  assert.equal(requests[0].address, '0x' + 'ab'.repeat(20)); assert.equal(requests[0].feeGranter, '');
  assert.equal(requests[1].bytes, 'AP8BYQ=='); assert.equal(requests[2].createTxHash, 'abc-original');
  assert.equal(requests[0].createTxHash, null); assert.ok(!Object.hasOwn(requests[0], 'bytes'));
  assert.deepEqual(requests[0].location, location); assert.ok(!JSON.stringify(f.storage).includes(secret));
});

test('잘못된 설정/네트워크/빈 저장소 키는 spawn 전에 거부하고 키는 호출마다 환경에서 다시 읽는다', async t => {
  const f = await fixture(t, 'process.stdout.write(JSON.stringify({ok:true,data:{exists:true}}));');
  for (const patch of [{ chainId: '05600' }, { rpcUrl: 'http://external.invalid' }, { timeoutMs: 0 },
     { address: 'invalid' }, { feeGranter: 'invalid' }]) assert.throws(() => new NodeGreenfieldStorage({ ...f.options, ...patch }));
  await rejects(() => f.storage.head({ ...location, chainId: 5600 }), 'WRONG_CHAIN');
  delete process.env[keyEnv]; await rejects(() => f.storage.head(location), 'STORAGE_ACCESS_DENIED');
  process.env[keyEnv] = '\u3000'; await rejects(() => f.storage.head(location), 'STORAGE_ACCESS_DENIED');
  process.env[keyEnv] = secret; assert.equal((await f.storage.head(location)).exists, true);
});

test('worker의 명시 생성 오류 사실만 보존하고 head 등에는 재전송 허가 사실을 붙이지 않는다', async t => {
  const f = await fixture(t, "process.stdout.write(JSON.stringify({ok:false,code:'STORAGE_ACCOUNT_UNFUNDED',definitelyNotBroadcast:true,definitelyRejected:true,message:'provider-secret'}));");
  for (const [invoke, flags] of [[() => f.storage.create(location, new Uint8Array([1])), true], [() => f.storage.head(location), false]]) {
    await assert.rejects(invoke, error => {
      assert.equal(error.code, 'STORAGE_ACCOUNT_UNFUNDED'); assert.equal(error.definitelyNotBroadcast, flags); assert.equal(error.definitelyRejected, flags);
      assert.ok(!String(error).includes('provider-secret')); assert.equal(error.cause, undefined); return true;
    });
  }
  await writeFile(f.workerPath, common + "process.stdout.write(JSON.stringify({ok:false,code:'NOT_AN_ENUM',definitelyNotBroadcast:true}));");
  await rejects(() => f.storage.head(location), 'STORAGE_UNAVAILABLE');
});

test('stdout 6 MiB 정확 경계를 허용하고 초과는 정리된 오류로 거부한다', { timeout: 10000 }, async t => {
  const body = "const base=JSON.stringify({ok:true,data:{exists:true,padding:''}});\n"
    + "process.stdout.write(base.replace('\"padding\":\"\"','\"padding\":\"'+'x'.repeat(6*1024*1024-base.length)+'\"'));";
  const f = await fixture(t, body); assert.equal((await f.storage.head(location)).exists, true);
  await writeFile(f.workerPath, common + body.replace('base.length)', 'base.length+1)'));
  await rejects(() => f.storage.head(location), 'STORAGE_UNAVAILABLE');
});

test('worker protocol malformed JSON/객체/data 오류는 Java JSON 계약처럼 INVALID_INPUT이고 unknown error는 fallback한다', async t => {
  const f = await fixture(t, '');
  for (const text of ['not json', '[]', '{"ok":true,"data":[]}', '{"ok":true}', '{"ok":true,"data":{},"ok":false}']) {
    await writeFile(f.workerPath, common + 'process.stdout.write(' + JSON.stringify(text) + ');');
    await rejects(() => f.storage.head(location), 'INVALID_INPUT');
  }
  await writeFile(f.workerPath, common + 'process.stdout.write(\'{"ok":false,"code":null}\');');
  await rejects(() => f.storage.head(location), 'STORAGE_UNAVAILABLE');
});

test('출력 대기 timeout·spawn 실패·EOF 후 미종료는 미전송 사실 없이 실패하고 AbortSignal을 구분한다', { timeout: 10000 }, async t => {
  const f = await fixture(t, 'setInterval(()=>{},1000);'), timed = new NodeGreenfieldStorage({ ...f.options, timeoutMs: 100 });
  await assert.rejects(() => timed.create(location, new Uint8Array([1])), error => error.code === 'STORAGE_UNAVAILABLE' && !error.definitelyNotBroadcast);
  const missing = new NodeGreenfieldStorage({ ...f.options, nodePath: join(f.dir, 'missing-node') });
  await rejects(() => missing.head(location), 'STORAGE_UNAVAILABLE');
  await writeFile(f.workerPath, common + 'process.stdout.end(\'{"ok":true,"data":{}}\');setInterval(()=>{},1000);');
  await rejects(() => f.storage.head(location), 'STORAGE_UNAVAILABLE');
  const controller = new AbortController(); controller.abort();
  await rejects(() => f.storage.head(location, controller.signal), 'INTERRUPTED');
  await writeFile(f.workerPath, common + "await fs.writeFile(new URL('./ready',import.meta.url),'ready');setInterval(()=>{},1000);");
  const active = new AbortController(), pending = f.storage.create(location, new Uint8Array([1]), active.signal);
  const result = rejects(() => pending, 'INTERRUPTED');
  for (;;) { try { await readFile(join(f.dir, 'ready')); break; } catch { await new Promise(resolve => setTimeout(resolve, 5)); } }
  active.abort(); await result;
});

test('base64는 Java 표준 decoder의 padding/문자 규칙을 적용하고 boolean은 true만 인정한다', async t => {
  const f = await fixture(t, 'process.stdout.write(\'{"ok":true,"data":{"bytes":"YQ","exists":"true","sealed":1,"matches":"true"}}\');');
  assert.deepEqual([...await f.storage.read(location)], [97]); assert.deepEqual(await f.storage.head(location), { exists: false, sealed: false });
  assert.equal(await f.storage.matchesCreateTransaction(location, 'hash'), false);
  for (const value of ['Y Q==', 'YQ=', 'YQ===', 'Y', '-_==']) {
    await writeFile(f.workerPath, common + 'process.stdout.write(JSON.stringify({ok:true,data:{bytes:' + JSON.stringify(value) + '}}));');
    await assert.rejects(() => f.storage.read(location), TypeError);
  }
});

test('요청 bytes/위치 snapshot은 호출 직후 변경과 분리하며 비영 exit라도 완성 protocol을 신뢰하는 원본 경계를 유지한다', async t => {
  const f = await fixture(t, "process.stdout.write(JSON.stringify({ok:true,data:{createTxHash:request.bytes+':'+request.location.objectName}}),()=>process.exit(7));");
  const target = { ...location }, bytes = new Uint8Array([1, 2]), pending = f.storage.create(target, bytes);
  target.objectName = 'changed'; bytes[0] = 9;
  assert.equal(await pending, 'AQI=:evidence.json');
});
