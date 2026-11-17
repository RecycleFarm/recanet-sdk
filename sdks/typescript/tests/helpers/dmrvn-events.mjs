import { DmrvnAbi } from '../../dist/index.js';

/** ABI 출력을 만들지 않고 실제 event의 indexed topic/data를 구성한다. */
export function eventLog(abi, name, values, address, extra = {}) {
  const inputs = abi.inputs(name), indexed = inputs.filter(f => f.indexed), normal = inputs.filter(f => !f.indexed);
  return { address, topics: [abi.topic(name), ...indexed.map(f => DmrvnAbi.encodeTuple([f], values))],
    data: DmrvnAbi.encodeTuple(normal, values), ...extra };
}
