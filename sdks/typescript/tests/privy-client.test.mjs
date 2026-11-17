import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createServer } from 'node:http';
import { PrivyClient, PrivyApiError } from '../dist/index.js';



const credentials = { appId: 'app', appSecret: 'secret' };
const errorIs = (code, status = 0) => error => {
  assert.ok(error instanceof PrivyApiError);
  assert.equal(error.code, code);
  assert.equal(error.statusCode, status);
  assert.ok(!inspect(error).includes('leaked-secret'));
  assert.equal(error.cause, undefined);
  return true;
};

test('초기화 무통신, 설정 snapshot과 secret 비노출, 정확한 인증 header', async () => {
  let calls = 0;
  const options = { ...credentials, fetch: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.privy.io/v1/users?limit=1.0');
    assert.equal(init.headers.authorization, 'Basic YXBwOnNlY3JldA==');
    assert.equal(init.headers['privy-app-id'], 'app');
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, 'error');
    return Response.json({ data: [], next_cursor: null });
  } };
  const client = new PrivyClient(options);
  assert.equal(calls, 0);
  options.appSecret = 'leaked-secret';
  assert.ok(!inspect(client).includes('secret'));
  assert.equal(JSON.stringify(client), '{}');
  await client.verifyAppCredentials();
  assert.equal(calls, 1);
});

test('origin과 자격 증명, timeout 입력 검증', () => {
  for (const origin of ['https://api.privy.io/', 'https://api.privy.io/path',
    'https://api.privy.io?', 'https://api.privy.io#', 'https://user@host',
    'http://remote', 'http://127.1', 'https://host\\path', 'https://host/..', 'ftp://host']) {
    assert.throws(() => new PrivyClient({ ...credentials, origin }), TypeError, origin);
  }
  for (const origin of ['http://localhost:8080', 'http://127.0.0.1', 'http://[::1]:80']) {
    assert.doesNotThrow(() => new PrivyClient({ ...credentials, origin }));
  }
  for (const appId of ['', 'a:b', 'a b', 'a\u0000b', '\u2000']) {
    assert.throws(() => new PrivyClient({ ...credentials, appId }), TypeError);
  }
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new PrivyClient({ ...credentials, timeoutMs }), TypeError);
  }
});

test('API 상태 오류와 Retry-After를 보존하고 자동 재시도하지 않는다', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIALS'], [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'], [503, 'UNAVAILABLE'], [404, 'INVALID_RESPONSE'], [201, 'INVALID_RESPONSE']]) {
    let calls = 0;
    const client = new PrivyClient({ ...credentials, fetch: async () => {
      calls++;
      return new Response('leaked-secret', { status, headers: { 'retry-after': '3' } });
    } });
    await assert.rejects(client.verifyAppCredentials(), error => {
      errorIs(code, status)(error);
      assert.equal(error.retryAfterMs, 3000n);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('잘못된 JSON/구조와 전송 예외의 원문을 노출하지 않는다', async () => {
  for (const body of ['not-json', '{}', 'null', '{"data":null}']) {
    const client = new PrivyClient({ ...credentials, fetch: async () => new Response(body) });
    await assert.rejects(client.verifyAppCredentials(), errorIs('INVALID_RESPONSE', 200));
  }
  const client = new PrivyClient({ ...credentials, fetch: async () => { throw new Error('leaked-secret'); } });
  await assert.rejects(client.verifyAppCredentials(), errorIs('UNAVAILABLE'));
});

test('Retry-After 첫 필드·날짜·int64 경계와 잘못된 값을 구분한다', async () => {
  const future = new Date(Date.now() + 60000).toUTCString();
  for (const [values, expected] of [
    [['3', '7'], 3000n], [['-1', '7'], undefined],
    [['9223372036854775807'], 9223372036854775807000n],
    [['9223372036854775808'], undefined], [['2026'], 2026000n],
    [['nonsense', '3'], undefined], [['2026-11-06'], undefined],
    [['Wed, 21 Oct 2015 07:28:00 GMT', '3'], 0n],
    [[future, '3'], 'future'],
  ]) {
    const headers = new Headers();
    for (const value of values) headers.append('retry-after', value);
    const client = new PrivyClient({ ...credentials, fetch: async () => new Response('', { status: 429, headers }) });
    await assert.rejects(client.verifyAppCredentials(), error => {
      if (expected === 'future') assert.ok(error.retryAfterMs > 50000n && error.retryAfterMs <= 60000n);
      else assert.equal(error.retryAfterMs, expected);
      return true;
    });
  }
});

test('정확히 4 MiB는 수용하고 초과 body는 취소한다', async () => {
  const prefix = '{"data":[],"padding":"';
  const suffix = '"}';
  for (const extra of [0, 1]) {
    let cancelled = false;
    const size = 4194304;
    const bytes = Buffer.from(prefix + ' '.repeat(size - prefix.length - suffix.length + extra) + suffix);
    const client = new PrivyClient({ ...credentials, fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes); if (!extra) controller.close(); },
      cancel() { cancelled = true; },
    })) });
    if (extra) {
      await assert.rejects(client.verifyAppCredentials(), errorIs('UNAVAILABLE'));
      assert.equal(cancelled, true);
    } else await client.verifyAppCredentials();
  }
});

test('로컬 HTTP의 header 이후 멈춘 body에도 timeout과 취소가 적용된다', async t => {
  let calls = 0, received;
  const server = createServer((req, res) => {
    calls++; received?.();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"data":[');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new PrivyClient({ ...credentials, origin: `http://127.0.0.1:${server.address().port}`, timeoutMs: 100 });
  await assert.rejects(client.verifyAppCredentials(), errorIs('UNAVAILABLE'));
  const controller = new AbortController();
  const started = new Promise(resolve => { received = resolve; });
  const pending = client.verifyAppCredentials(controller.signal);
  await started;
  controller.abort('leaked-secret');
  await assert.rejects(pending, errorIs('INTERRUPTED'));
  assert.equal(calls, 2);
});

test('이미 취소된 요청은 fetch를 시작하지 않는다', async () => {
  let calls = 0;
  const client = new PrivyClient({ ...credentials, fetch: async () => { calls++; return Response.json({ data: [] }); } });
  await assert.rejects(client.verifyAppCredentials(AbortSignal.abort('leaked-secret')), errorIs('INTERRUPTED'));
  assert.equal(calls, 0);
});
