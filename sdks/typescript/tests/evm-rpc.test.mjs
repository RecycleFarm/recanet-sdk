import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createServer } from 'node:http';
import { HttpEvmRpc, DmrvnError } from '../dist/index.js';


import { canonicalChainJson, parseChainJson } from '../dist/internal/chain-json.js';

const errorIs = code => error => {
  assert.ok(error instanceof DmrvnError);
  assert.equal(error.code, code);
  assert.equal(error.cause, undefined);
  assert.ok(!inspect(error).includes('provider-secret'));
  return true;
};
const rpcWithBody = body => new HttpEvmRpc('https://node.invalid/rpc?key=provider-secret', {
  fetch: async () => new Response(body),
});

test('RPC 요청은 인스턴스별 id·JSON POST를 사용하고 provider에 앱 비밀을 보내지 않는다', async () => {
  const ids = [];
  const rpc = new HttpEvmRpc('https://node.invalid/rpc?key=provider-secret', { fetch: async (url, init) => {
    assert.equal(url, 'https://node.invalid/rpc?key=provider-secret');
    assert.deepEqual(init.headers, { 'content-type': 'application/json' });
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body);
    ids.push(body.id);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.method, 'eth_chainId');
    assert.deepEqual(body.params, []);
    return Response.json({ jsonrpc: '2.0', id: body.id, result: '0x66eee' });
  } });
  assert.equal(ids.length, 0);
  const results = await Promise.all(Array.from({ length: 32 }, () => rpc.call('eth_chainId', [])));
  assert.equal(results.length, 32);
  assert.deepEqual(ids, Array.from({ length: 32 }, (_, i) => i + 1));
  const separate = new HttpEvmRpc('https://node.invalid', { fetch: async (_, init) => {
    assert.equal(JSON.parse(init.body).id, 1);
    return Response.json({ jsonrpc: '2.0', id: '1', result: null });
  } });
  assert.equal(await separate.call('anything', []), null);
});

test('RPC envelope와 error 존재 여부를 판정하고 원문·재시도를 노출하지 않는다', async () => {
  for (const body of [
    '{"jsonrpc":"1.0","id":1,"result":null}', '{"jsonrpc":"2.0","id":2,"result":null}',
    '{"jsonrpc":"2.0","id":1}', '{"jsonrpc":"2.0","id":1.0,"result":null}',
    '{"jsonrpc":"2.0","id":"01","result":null}',
  ]) await assert.rejects(rpcWithBody(body).call('eth_chainId', []), errorIs('RPC_UNAVAILABLE'));
  for (const [method, code] of [['eth_estimateGas', 'GAS_ESTIMATION_FAILED'], ['eth_call', 'GAS_ESTIMATION_FAILED'],
    ['eth_chainId', 'RPC_UNAVAILABLE']]) {
    await assert.rejects(rpcWithBody('{"jsonrpc":"2.0","id":1,"result":null,"error":null}').call(method, []), errorIs(code));
  }
  for (const status of [201, 429, 500]) {
    let calls = 0;
    const rpc = new HttpEvmRpc('https://node.invalid', { fetch: async () => {
      calls++; return new Response('provider-secret', { status });
    } });
    await assert.rejects(rpc.call('eth_chainId', []), errorIs('RPC_UNAVAILABLE'));
    assert.equal(calls, 1);
  }
});

test('JSON의 정수·소수·Unicode를 부동소수점 변환 전 검증한다', () => {
  const parse = text => parseChainJson(Buffer.from(text));
  for (const text of ['{"a":1,"a":2}', '{} {}', '{"x":-0}', '{"x":9007199254740992}',
    '{"x":-9007199254740992}', '{"x":0.10000000000000000001}', '{"x":1e400}',
    '{"x":1e-400}', '{"x":"\\ud800"}', '{"\\udfff":1}', '\ufeff{}']) {
    assert.throws(() => parse(text), errorIs('INVALID_INPUT'), text);
  }
  assert.throws(() => parseChainJson(new Uint8Array([0xc0, 0xaf])), errorIs('INVALID_INPUT'));
  const result = parse('{"integer":9007199254740991,"decimal":0.1,"largeDecimal":1.0e20,"negativeZero":-0.0,"emoji":"😀"}');
  assert.equal(result.integer, 9007199254740991);
  assert.equal(result.decimal, 0.1);
  assert.equal(result.largeDecimal, 1e20);
  assert.equal(result.emoji, '😀');
  assert.equal(canonicalChainJson({ 'a"b': '\u000f', number: 0.1 }), '{"a\\"b":"\\u000F","number":0.1}');
  assert.equal(canonicalChainJson({ literal: '\\u000f' }), JSON.stringify({ literal: '\\u000f' }));
});

test('JSON 파싱 오류와 객체가 아닌 envelope는 INVALID_INPUT이다', async () => {
  for (const body of ['{', '[]', 'null', '{"jsonrpc":"2.0","id":1,"result":-0}',
    '{"jsonrpc":"2.0","id":1,"id":1,"result":null}']) {
    await assert.rejects(rpcWithBody(body).call('eth_chainId', []), errorIs('INVALID_INPUT'));
  }
});

test('정확히 4 MiB body는 허용하고 초과 응답은 취소한다', async () => {
  for (const extra of [0, 1]) {
    let cancelled = false;
    const json = '{"jsonrpc":"2.0","id":1,"result":null,"padding":""}';
    const body = json.slice(0, -2) + ' '.repeat(4194304 - json.length + extra) + '"}';
    const rpc = new HttpEvmRpc('https://node.invalid', { fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from(body)); if (!extra) controller.close(); },
      cancel() { cancelled = true; },
    })) });
    if (extra) {
      await assert.rejects(rpc.call('eth_chainId', []), errorIs('RPC_UNAVAILABLE'));
      assert.equal(cancelled, true);
    } else assert.equal(await rpc.call('eth_chainId', []), null);
  }
});

test('로컬 RPC body 완료까지 timeout과 AbortSignal 취소를 적용한다', async t => {
  const server = createServer((_, response) => { response.writeHead(200); response.write('{"jsonrpc":"2.0",'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const rpc = new HttpEvmRpc(`http://127.0.0.1:${server.address().port}/rpc`, { timeoutMs: 60 });
  await assert.rejects(rpc.call('eth_chainId', []), errorIs('RPC_UNAVAILABLE'));
  const controller = new AbortController();
  const pending = rpc.call('eth_chainId', [], controller.signal);
  setTimeout(() => controller.abort('provider-secret'), 10);
  await assert.rejects(pending, errorIs('INTERRUPTED'));
});

test('header 대기 제한과 이미 취소된 요청은 외부 진행을 중단한다', async () => {
  let calls = 0;
  let aborted = false;
  const rpc = new HttpEvmRpc('https://node.invalid', { connectTimeoutMs: 10, timeoutMs: 1000, fetch: async (_, init) => {
    calls++; init.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {});
  } });
  await assert.rejects(rpc.call('eth_chainId', []), errorIs('RPC_UNAVAILABLE'));
  assert.equal(aborted, true);
  await assert.rejects(rpc.call('eth_chainId', [], AbortSignal.abort()), errorIs('INTERRUPTED'));
  assert.equal(calls, 1);
});

test('RPC URI와 timeout은 Privy origin과 별도로 검사한다', () => {
  for (const url of ['HTTP://localhost/rpc', 'http://LOCALHOST/rpc', 'http://remote/rpc', 'http://127.1/rpc',
    'https://user@host/rpc', 'https://host/rpc#fragment', 'https://host\\rpc', 'https://host/rpc\n']) {
    assert.throws(() => new HttpEvmRpc(url), errorIs('INVALID_INPUT'), url);
  }
  for (const url of ['http://localhost/rpc?a=1', 'http://127.0.0.1:8080/', 'http://[::1]/rpc', 'https://HOST/path?x=y']) {
    assert.doesNotThrow(() => new HttpEvmRpc(url));
  }
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => new HttpEvmRpc('https://node.invalid', { timeoutMs }), errorIs('INVALID_INPUT'));
  }
});
