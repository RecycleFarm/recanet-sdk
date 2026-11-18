import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspect } from 'node:util';
import { GreenfieldPublicReader } from '../dist/index.js';



const location = { storageType: 1, chainId: '5600', bucketName: 'bucket', objectName: 'path/report.json' };
const code = expected => error => {
  assert.equal(error.code, expected); assert.equal(error.cause, undefined);
  assert.ok(!inspect(error).includes('provider-secret')); return true;
};

test('공개 객체를 직접 GET하고 Java 호환 인코딩·trailing slash·원시 bytes를 보존한다', async () => {
  let calls = 0;
  const original = new Uint8Array([0, 1, 255]);
  const reader = new GreenfieldPublicReader('https://sp.invalid/api///', '5600', { fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://sp.invalid/api/bucket%20%21%7E%27%28%29*/a%20b/%ED%95%9C%EA%B8%80/%252F/');
    assert.equal(init.method, 'GET'); assert.equal(init.headers, undefined);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    return new Response(original);
  } });
  assert.equal(calls, 0);
  const value = await reader.read({ ...location, storageType: '1', bucketName: "bucket !~'()*", objectName: 'a b/한글/%2F/' });
  assert.deepEqual([...value], [0, 1, 255]);
  original[0] = 99;
  assert.equal(value[0], 0);
  assert.equal(calls, 1);
});

test('네트워크/storage type 불일치·잘못된 위치·query를 외부 요청 전에 거부한다', async () => {
  let calls = 0;
  const reader = new GreenfieldPublicReader('https://sp.invalid', '5600', { fetch: async () => { calls++; return new Response(''); } });
  for (const extra of [{ chainId: 5600 }, { chainId: 'other' }, { storageType: 2 }]) {
    await assert.rejects(reader.read({ ...location, ...extra }), code('WRONG_CHAIN'));
  }
  for (const extra of [{ bucketName: null }]) {
    await assert.rejects(reader.read({ ...location, ...extra }), code('INVALID_INPUT'));
  }
  assert.equal(calls, 0);
  for (const endpoint of ['https://sp.invalid?', 'https://sp.invalid?key=provider-secret', 'http://remote', 'https://sp.invalid#x']) {
    assert.throws(() => new GreenfieldPublicReader(endpoint, '5600'), code('INVALID_INPUT'));
  }
});

test('HTTP 권한 거부와 다른 상태·전송 실패를 구분하고 원문/재시도를 노출하지 않는다', async () => {
  for (const [status, expected] of [[401, 'STORAGE_ACCESS_DENIED'], [403, 'STORAGE_ACCESS_DENIED'],
    [404, 'STORAGE_UNAVAILABLE'], [429, 'STORAGE_UNAVAILABLE'], [500, 'STORAGE_UNAVAILABLE'], [201, 'STORAGE_UNAVAILABLE']]) {
    let calls = 0;
    const reader = new GreenfieldPublicReader('https://sp.invalid', '5600', { fetch: async () => {
      calls++; return new Response('provider-secret', { status });
    } });
    await assert.rejects(reader.read(location), code(expected));
    assert.equal(calls, 1);
  }
  const failed = new GreenfieldPublicReader('https://sp.invalid', '5600', { fetch: async () => { throw new Error('provider-secret'); } });
  await assert.rejects(failed.read(location), code('STORAGE_UNAVAILABLE'));
});

test('4 MiB 정확 경계와 초과 body 취소를 적용한다', async () => {
  for (const extra of [0, 1]) {
    let cancelled = false;
    const reader = new GreenfieldPublicReader('https://sp.invalid', '5600', { fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(4194304 + extra)); if (!extra) controller.close(); },
      cancel() { cancelled = true; },
    })) });
    if (extra) { await assert.rejects(reader.read(location), code('STORAGE_UNAVAILABLE')); assert.equal(cancelled, true); }
    else assert.equal((await reader.read(location)).length, 4194304);
  }
});

test('본문 전체 timeout·호출 취소·늦게 도착한 body 취소를 확인한다', async t => {
  const server = createServer((_, response) => { response.writeHead(200); response.write('partial'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const reader = new GreenfieldPublicReader(`http://127.0.0.1:${server.address().port}`, '5600', { timeoutMs: 50 });
  await assert.rejects(reader.read(location), code('STORAGE_UNAVAILABLE'));
  const controller = new AbortController();
  const pending = reader.read(location, controller.signal);
  controller.abort('provider-secret');
  await assert.rejects(pending, code('INTERRUPTED'));
  let respond;
  let cancelled = false;
  const late = new GreenfieldPublicReader('https://sp.invalid', '5600', { connectTimeoutMs: 10, timeoutMs: 1000,
    fetch: async () => new Promise(resolve => { respond = resolve; }) });
  await assert.rejects(late.read(location), code('STORAGE_UNAVAILABLE'));
  respond(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(cancelled, true);
});
