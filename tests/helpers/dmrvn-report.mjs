import { readFile } from 'node:fs/promises';
import { DmrvnAbi, DmrvnJson, DmrvnReader } from '../../dist/index.js';
import { chainFixture } from './dmrvn-chain.mjs';
import { eventLog } from './dmrvn-events.mjs';

const pet = JSON.parse(await readFile(new URL('../fixtures/dmrvn-pet.json', import.meta.url), 'utf8'));
export function reportFixture() {
  const f = chainFixture(true, 3); f.state.head = 107n;
  const stored = DmrvnJson.copy(pet.expectedFinalClaim);
  for (const key of ['partnerId', 'activityId', 'methodologyId', 'methodologyVersion']) stored[key] = pet.claimRequest[key];
  stored.requestedAt = '1999999100'; stored.finalizedAt = '1999999200';
  const hash = '0x' + 'cd'.repeat(32), id = pet.claimRequest.claimId;
  const event = eventLog(DmrvnAbi.CLAIM, 'MrvClaimReported', { claimId: id, taskId: pet.assignment.taskId,
    committeeHash: pet.assignment.committeeHash, status: stored.status, outputHash: stored.outputHash, reportHash: stored.reportHash,
    reporter: pet.actors.coordinator }, f.target,
    { transactionHash: hash });
  const observed = { stored, bytes: DmrvnJson.bytes(pet.report), tx: { to: f.target, input: pet.onReportCalldata, hash, blockHash: f.state.blockHash },
    receipt: { transactionHash: hash, blockNumber: '0x64', blockHash: f.state.blockHash, status: '0x1', logs: [event] }, logs: [event],
    readError: null, resolveError: null };
  const counts = { reads: 0, resolves: 0 }, calls = [], call = f.rpc.call.bind(f.rpc);
  f.rpc.call = async (method, params, signal) => {
    calls.push({ method, params });
    if (method === 'eth_call' && params[0].to === f.target && params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0, 10))) {
      return f.result(DmrvnAbi.CLAIM, 'getClaim', { '': observed.stored });
    }
    if (method === 'eth_getTransactionReceipt') return observed.receipt;
    if (method === 'eth_getTransactionByHash') return observed.tx;
    if (method === 'eth_getLogs') return observed.logs;
    return call(method, params, signal);
  };
  const resolver = { async resolve(hash) { counts.resolves++; if (observed.resolveError) throw observed.resolveError;
    return DmrvnReader.defaultReportResolver('5600', 'reports').resolve(hash); } };
  const reader = { async read(location) { counts.reads++; counts.location = location; if (observed.readError) throw observed.readError; return observed.bytes; } };
  const client = new DmrvnReader(f.config, f.rpc, reader, resolver);
  return { ...f, observed, reportCalls: calls, counts, resolver, reader, client, hash, id, pet };
}
