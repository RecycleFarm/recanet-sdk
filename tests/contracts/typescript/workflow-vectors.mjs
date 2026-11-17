import { resolutionFixture } from '../../../sdks/typescript/tests/helpers/dmrvn-resolution.mjs';
import { Wallet } from '../../../sdks/typescript/node_modules/ethers/lib.esm/index.js';
import { workflowFixture } from '../../../sdks/typescript/tests/helpers/dmrvn-workflow.mjs';
import { reportFixture } from '../../../sdks/typescript/tests/helpers/dmrvn-report.mjs';
import { DmrvnAbi } from '../../../sdks/typescript/dist/dmrvn-abi.js';
import { Json, DmrvnProtocol, DmrvnError } from '../../../sdks/typescript/dist/index.js';
const copy=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?Number(v):v));
export async function workflowVectors() {
  const cases=[];
  for(const scenario of['normal','self-paid','lost-create','unsealed','storage-mismatch','role-denied','methodology-inactive','nonce-changed','submission-lost','cost-limit','expired','signature-invalid']) {
    const f=workflowFixture(),events=[],actions=[],operator=f.operator.address;
    if(scenario==='role-denied')f.state.role=false;
    if(scenario==='methodology-inactive')f.status.active=false;
    if(scenario==='unsealed')f.status.sealOnUpload=false;
    if(scenario==='storage-mismatch')f.storage.read=async()=>new Uint8Array([1]);
    if(scenario==='lost-create')f.storage.create=async()=>{f.counts.creates++;throw new DmrvnError('STORAGE_CREATE_UNRESOLVED');};
    f.state.balance='0xde0b6b3a7640000';
    let forwarded,signature,submitted=false;
    const txHash='0x'+'cd'.repeat(32);
    const originalRpc=f.rpc.call.bind(f.rpc);
    f.rpc.call=async(method,params,signal)=>{
      if(method==='eth_estimateGas')return scenario==='cost-limit'?'0xffffffffffffffff':'0x10000';
      if(method==='eth_gasPrice')return '0x2';
      if(method==='eth_getTransactionCount')return '0x0';
      if(method==='eth_call' && params[0].to===f.forwarder) {
        if(params[0].data.startsWith(DmrvnAbi.FORWARDER.topic('verify').slice(0,10)))return DmrvnAbi.encodeTuple(DmrvnAbi.FORWARDER.outputs('verify'),{'':true});
        if(params[1]==='pending')return '0x';
      }
      if(method==='eth_call' && params[0].to===f.target && params[0].data.startsWith(DmrvnAbi.CLAIM.topic('getClaim').slice(0,10))) {
        const state=await f.client.operation('operation-one'),r=state.approved.claimRequest;
        return DmrvnAbi.encodeTuple(DmrvnAbi.CLAIM.outputs('getClaim'),{'':{...r,approver:operator,status:submitted?1:0,
          evidenceLocationHash:DmrvnProtocol.evidenceLocationHash(r.evidenceLocation),outputHash:'0x'+'00'.repeat(32),reportHash:'0x'+'00'.repeat(32),requestedAt:'291',finalizedAt:'0'}});
      }
      return originalRpc(method,params,signal);
    };
    f.operator.sendTransaction=async()=>{if(scenario==='submission-lost')throw new DmrvnError('RPC_UNAVAILABLE');submitted=true;return txHash;};
    const capture=(kind,fn)=>async(...args)=>{
      const saved=copy(args.filter(x=>x!==undefined));
      try {const result=await fn(...args);events.push({kind,args:saved,result:result instanceof Uint8Array?{bytes:Buffer.from(result).toString('base64')}:copy(result??null)});return result;}
      catch(e){events.push({kind,args:saved,error:e.code??'RPC_UNAVAILABLE',definitelyNotBroadcast:e.definitelyNotBroadcast===true,definitelyRejected:e.definitelyRejected===true});throw e;}
    };
    f.rpc.call=capture('rpc',f.rpc.call.bind(f.rpc));
    for(const key of['signMessage','signTypedData','sendTransaction'])f.operator[key]=capture(key,f.operator[key].bind(f.operator));
    for(const key of['head','create','upload','read','matchesCreateTransaction']) {
      const fn=f.storage[key].bind(f.storage);f.storage[key]=async(...args)=>{
        const saved=args.map(x=>x instanceof Uint8Array?{bytes:Buffer.from(x).toString('base64')}:x);
        return capture('storage.'+key,async()=>fn(...args))(...saved);
      };
    }
    const execute=async(method,args)=>{actions.push({method,args:copy(args)});try{return await f.client[method](...args);}catch{return null;}};
    await execute('preflight',[]);
    await execute('prepareEvidence',['operation-one',f.claimId,f.beneficiary,f.objectName,f.body]);
    await execute('prepareEvidence',['operation-one',f.claimId,f.beneficiary,f.objectName,f.body]);
    const approved=await execute('approveClaim',['operation-one']);
    if(approved) {
      if(scenario==='self-paid') {await execute('prepareSelfPaid',['operation-one']);await execute('prepareSelfPaid',['operation-one']);await execute('prepareSponsored',['operation-one','100000']);}
      else {
        const prepared=await execute('prepareSponsored',['operation-one','100000']);
        if(prepared) {
          forwarded=prepared.forwardRequest;const types={...prepared.types};delete types.EIP712Domain;
          signature=await new Wallet('0x'+'00'.repeat(31)+'01').signTypedData(prepared.domain,types,forwarded);
          if(scenario==='nonce-changed')f.state.forwardNonce='0';
          if(scenario==='expired')f.state.timestamp=100000n;
          if(scenario==='signature-invalid')signature='0x'+'00'.repeat(65);
          await execute('recordSponsoredSignature',['operation-one',forwarded,signature]);
          await execute('submitSponsored',['operation-one',forwarded,signature]);
          // A second call must investigate the existing intent, never send twice.
          await execute('submitSponsored',['operation-one',forwarded,signature]);
        }
      }
    }
    await execute('operation',['operation-one']);
    const wasm=Buffer.from([0,97,115,109,1,0,0,0]);
    const {keccak}=await import('../../../sdks/typescript/dist/dmrvn-crypto.js');
    const manifest={activityId:1003,methodology:{id:2003,version:1},wasmHash:keccak(wasm)};
    cases.push({name:'workflow '+scenario,op:'workflow',config:{...f.config,maxRelayCostWei:String(f.config.maxRelayCostWei),deployment:f.config.deployment.snapshot()},
      operator,storageAddress:f.storage.address,manifest:Json.canonical(manifest),wasm:wasm.toString('base64'),hash:Json.hash(manifest),schema:999,
      registryActive:f.status.active,events,actions});
  }
  for(const sponsored of[false,true])for(const scenario of['confirmed','sender-mismatch','receipt-missing','claim-mismatch','revoked-role']) {
    const f=await resolutionFixture(sponsored),events=[];
    if(scenario==='sender-mismatch')f.observed.tx.from='0x'+'01'.repeat(20);
    if(scenario==='receipt-missing')f.observed.receipt=null;
    if(scenario==='claim-mismatch')f.observed.claim.partnerId=102;
    if(scenario==='revoked-role')f.state.role=false;
    const seed={['operation:'+f.operation]:await f.client.operation(f.operation)};
    for(const key of['claim-id:'+f.claimId,'claim-nonce:'+f.config.deploymentId()+':'+f.beneficiary,'relay-nonce:'+f.config.chainId+':'+f.wallet.address.toLowerCase()]) {
      const state=await f.journal.load(key);if(state)seed[key]=state;
    }
    const original=f.rpc.call.bind(f.rpc);f.rpc.call=async(...args)=>{
      try{const result=await original(...args);events.push({kind:'rpc',args:copy(args.filter(x=>x!==undefined)),result:copy(result)});return result;}
      catch(e){events.push({kind:'rpc',args:copy(args),error:e.code??'RPC_UNAVAILABLE'});throw e;}
    };
    const actions=[{method:'resolveSubmission',args:[f.operation,null]},{method:'operation',args:[f.operation]}];
    for(const step of actions)try{await f.client[step.method](...step.args);}catch{}
    const wasm=Buffer.from([0,97,115,109,1,0,0,0]),{keccak}=await import('../../../sdks/typescript/dist/dmrvn-crypto.js');
    const manifest={activityId:1003,methodology:{id:2003,version:1},wasmHash:keccak(wasm)};
    cases.push({name:'resolve '+sponsored+' '+scenario,op:'workflow',config:{...f.config,maxRelayCostWei:String(f.config.maxRelayCostWei),deployment:f.config.deployment.snapshot()},
      operator:f.operator.address,storageAddress:f.storage.address,manifest:Json.canonical(manifest),wasm:wasm.toString('base64'),hash:Json.hash(manifest),schema:999,registryActive:true,seed,events,actions});
  }
  for(const scenario of['valid','read-fails','missing-hash','report-tamper','external-hash-mismatch','pending','revoked','bad-committee']) {
    const f=reportFixture(),events=[];
    if(scenario==='read-fails')f.observed.readError=new Error('read');
    if(scenario==='report-tamper')f.observed.bytes=Buffer.from('{}');
    if(scenario==='pending')f.observed.stored.status=1;
    if(scenario==='revoked')f.observed.stored.status=4;
    if(scenario==='bad-committee')f.observed.tx.input='0x00';
    const record=(kind,fn)=>async(...args)=>{try{const result=await fn(...args);events.push({kind,args:copy(args.filter(x=>x!==undefined)),result:result instanceof Uint8Array?{bytes:Buffer.from(result).toString('base64')}:copy(result)});return result;}catch(e){events.push({kind,args:copy(args),error:'REPORT_READ_FAILED'});throw e;}};
    f.rpc.call=record('rpc',f.rpc.call.bind(f.rpc));f.reader.read=record('report.read',f.reader.read.bind(f.reader));f.resolver.resolve=record('report.resolve',f.resolver.resolve.bind(f.resolver));
    const args=[f.id,scenario==='missing-hash'?null:0,scenario==='missing-hash'?null:f.hash,false,scenario==='external-hash-mismatch'?'0x'+'00'.repeat(32):null];
    await f.client.readResult(...args);
    cases.push({name:'reader '+scenario,op:'reader',config:{...f.config,maxRelayCostWei:String(f.config.maxRelayCostWei),deployment:f.config.deployment.snapshot()},events,args});
  }
  return cases;
}
