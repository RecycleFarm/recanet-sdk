import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AbiCoder, Interface } from 'ethers';
import { DmrvnAbi, DmrvnCrypto as crypto } from '../dist/index.js';

const fixture = async name => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const invalid = error => { assert.equal(error.code, 'INVALID_INPUT'); return true; };
const mutate = (data, offset, byte) => {
  const value = Buffer.from(data.slice(2), 'hex'); value[offset] = byte; return '0x' + value.toString('hex');
};

test('동봉 ABI의 함수 selector와 event topic 전체가 기준 벡터와 일치한다', async () => {
  const primitive = await fixture('dmrvn-primitives.json');
  for (const [file, abi] of [['dmrvn-claim-v7.json', DmrvnAbi.CLAIM], ['dmrvn-forwarder.json', DmrvnAbi.FORWARDER],
    ['proxy-admin.json', DmrvnAbi.PROXY_ADMIN]]) {
    for (const entry of primitive.abi[file]) {
      assert.equal(abi.signature(entry.name), entry.signature);
      assert.equal(entry.kind === 'event' ? abi.topic(entry.name) : abi.topic(entry.name).slice(0, 10), entry.selectorOrTopic);
    }
  }
});

test('과거 PET의 submitClaim·execute calldata가 byte 단위로 일치하고 재인코딩된다', async () => {
  const pet = await fixture('dmrvn-pet.json');
  const submit = DmrvnAbi.CLAIM.encode('submitClaim', { request: pet.claimRequest, approvalSignature: pet.approvalSignature });
  assert.equal(submit, pet.selfPaid.data);
  const decoded = DmrvnAbi.CLAIM.decodeCall('submitClaim', submit);
  assert.equal(decoded.request.partnerId, pet.claimRequest.partnerId);
  assert.equal(decoded.request.nonce, String(pet.claimRequest.nonce));
  assert.equal(decoded.request.deadline, String(pet.claimRequest.deadline));
  assert.equal(DmrvnAbi.CLAIM.encode('submitClaim', decoded), submit);
  const request = { ...pet.sponsored.forwardRequest, signature: pet.sponsored.userSignature };
  delete request.nonce;
  const execute = DmrvnAbi.FORWARDER.encode('execute', { request });
  assert.equal(execute, pet.sponsored.executeCalldata);
  assert.equal(DmrvnAbi.FORWARDER.encode('execute', DmrvnAbi.FORWARDER.decodeCall('execute', execute)), execute);
  const standard = new Interface([DmrvnAbi.CLAIM.definition('submitClaim')]);
  assert.equal(standard.encodeFunctionData('submitClaim', [pet.claimRequest, pet.approvalSignature]), submit);
  const report = DmrvnAbi.CLAIM.encode('onReport', { assignment: pet.assignment, committee: pet.actors.committee,
    coordinatorSignature: pet.coordinatorSignature, observation: pet.observations[0].observation,
    observationSignatures: pet.observations.map(entry => entry.signature) });
  assert.equal(report, pet.onReportCalldata);
  assert.equal(DmrvnAbi.CLAIM.encode('onReport', DmrvnAbi.CLAIM.decodeCall('onReport', report)), report);
});

test('동적 tuple·bytes 배열은 sequence 시작 offset으로 인코딩하고 1024 상한을 적용한다', () => {
  const fields = [{ name: 'items', type: 'bytes[]' }, { name: 'text', type: 'string' }];
  const values = { items: ['0x', '0x112233', '0x' + 'ab'.repeat(33)], text: '한글😀' };
  const encoded = DmrvnAbi.encodeTuple(fields, values);
  assert.equal(encoded, AbiCoder.defaultAbiCoder().encode(['bytes[]', 'string'], [values.items, values.text]));
  const decoded = DmrvnAbi.decodeTuple(fields, encoded);
  assert.deepEqual(decoded.items, values.items);
  assert.equal(decoded.text, values.text);
  assert.throws(() => DmrvnAbi.encodeTuple(fields, { ...values, items: Array(1025).fill('0x') }), invalid);
  const hugeCount = '0x' + crypto.hexString(crypto.word(32n)).slice(2) + crypto.hexString(crypto.word(1025n)).slice(2);
  assert.throws(() => DmrvnAbi.decodeTuple([{ name: 'items', type: 'bytes[]' }], hugeCount), invalid);
});

test('call decode는 trailing·동적 padding·다른 selector를 거부하지만 output은 재인코딩하지 않는다', () => {
  const abi = new DmrvnAbi([{ type: 'function', name: 'f', inputs: [{ name: 'value', type: 'bytes' }], outputs: [{ name: 'value', type: 'bytes' }] }]);
  const data = abi.encode('f', { value: '0x01' });
  assert.throws(() => abi.decodeCall('f', data + '00'), invalid);
  assert.throws(() => abi.decodeCall('f', mutate(data, 4 + 64 + 1, 255)), invalid);
  assert.throws(() => abi.decodeCall('f', '0x00000000' + data.slice(10)), invalid);
  const output = data.slice(10);
  const result = abi.decodeOutput('f', '0x' + output + 'ffff');
  assert.equal(result.value, '0x01');
});

test('ABI의 uint 폭·주소 상위 padding·bool·bytes1 padding·UTF8를 검사한다', () => {
  for (const [field, word] of [
    [{ name: 'x', type: 'uint8' }, crypto.word(256n)],
    [{ name: 'x', type: 'bool' }, crypto.word(2n)],
    [{ name: 'x', type: 'address' }, crypto.word(1n << 160n)],
    [{ name: 'x', type: 'bytes1' }, crypto.word(1n)],
  ]) assert.throws(() => DmrvnAbi.decodeTuple([field], crypto.hexString(word)), invalid);
  assert.throws(() => DmrvnAbi.encodeTuple([{ name: 'x', type: 'bool' }], { x: 1 }), invalid);
  assert.throws(() => DmrvnAbi.encodeTuple([{ name: 'x', type: 'uint8' }], { x: '01' }), invalid);
  assert.throws(() => DmrvnAbi.decodeTuple([{ name: 'x', type: 'bytes32' }], '0x00'), invalid);
  const encoded = DmrvnAbi.encodeTuple([{ name: 'x', type: 'string' }], { x: 'a' });
  assert.throws(() => DmrvnAbi.decodeTuple([{ name: 'x', type: 'string' }], mutate(encoded, 64, 255)), invalid);
  const overflow = '0x' + crypto.hexString(crypto.word(1n << 32n)).slice(2);
  assert.throws(() => DmrvnAbi.decodeTuple([{ name: 'x', type: 'string' }], overflow), invalid);
});

test('event topic0·topic 수를 검증하고 indexed와 normal 필드를 합친다', () => {
  const abi = new DmrvnAbi([{ type: 'event', name: 'E', inputs: [{ name: 'who', type: 'address', indexed: true },
    { name: 'count', type: 'uint32' }] }]);
  const who = '0x' + 'ab'.repeat(20);
  const log = { topics: [abi.topic('E'), crypto.hexString(crypto.word(BigInt(who)))],
    data: DmrvnAbi.encodeTuple([{ name: 'count', type: 'uint32' }], { count: 7 }) };
  assert.equal(abi.decodeEvent('E', log).who, who);
  assert.equal(abi.decodeEvent('E', log).count, 7);
  assert.throws(() => abi.decodeEvent('E', { ...log, topics: [...log.topics, crypto.ZERO_BYTES32] }), invalid);
  assert.throws(() => abi.decodeEvent('E', { ...log, topics: [crypto.ZERO_BYTES32, log.topics[1]] }), invalid);
});

test('ABI schema는 호출자 변경과 분리하고 필요한 키만 인코딩한다', () => {
  const definitions = [{ type: 'function', name: 'f', inputs: [{ name: 'x', type: 'uint8' }], outputs: [] }];
  const abi = new DmrvnAbi(definitions);
  definitions[0].inputs[0].type = 'string';
  assert.equal(abi.signature('f'), 'f(uint8)');
  assert.ok(Object.isFrozen(abi.inputs('f')[0]));
  assert.equal(abi.encode('f', { x: 1, extra: 'ignored' }), abi.encode('f', { x: 1 }));
  assert.throws(() => abi.encode('f', {}), invalid);
});
