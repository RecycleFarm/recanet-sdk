import { dmrvnUri } from '../../../sdks/typescript/dist/internal/dmrvn-uri.js';
import { canonicalPrivy059, prepareAuthorization } from '../../../sdks/typescript/dist/internal/authorization.js';
import { javaDouble, javaFloat } from '../../../sdks/typescript/dist/internal/java-number.js';
import { MemoryOperationJournal } from '../../../sdks/typescript/dist/memory-operation-journal.js';
import { createInterface } from 'node:readline';
import { Duration, ActivityRequest, Json, DmrvnDeployment, DeclaredMethodology, DmrvnProtocol, DmrvnError,
  EvmTransactionQuery, AssetClient, EvmTransactionClient, PrivyTokenVerifier, FileOperationJournal, GreenfieldPublicReader,
  Float32, Float64, PrivyTokenVerificationConfig, PrivyClientConfig, PrivyClient, BackendWalletRegistration, BackendWalletCreateRequest, DmrvnConfig, DmrvnClient, DmrvnReader } from '../../../sdks/typescript/dist/index.js';
let input, trace;
const family = e => e.name === 'IllegalStateException' ? 'state' : e.code ?
  e.name === 'TransactionQueryError' ? 'transaction' : e.name === 'PrivyAuthenticationError' ? 'authentication' : e.name === 'PrivyApiError' ? 'privy' : 'dmrvn'
  : e instanceof TypeError || e instanceof RangeError ? 'argument' : 'runtime';
function rpc() { let index=0; return { async call(method,params) {
  trace.push({method,params}); const item=input.rpc[index++];
  if (!item || item.method!==method) throw new Error('Unexpected RPC');
  if(item.error)throw new DmrvnError(item.error);return item.result;
} }; }
function replay() {
  let index=0;
  const plain=x=>x instanceof Uint8Array?{bytes:Buffer.from(x).toString('base64')}:typeof x==='bigint'?Number(x):Array.isArray(x)?x.map(plain):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,plain(v)])):x;
  const call=(kind,args)=>{
    const saved=plain(args.filter(x=>x!==undefined));trace.push({kind,args:saved});
    const event=input.events[index++];
    if(!event || event.kind!==kind)throw new Error('Unexpected adapter call '+kind);
    if(event.error)throw new DmrvnError(event.error,{definitelyNotBroadcast:event.definitelyNotBroadcast,definitelyRejected:event.definitelyRejected});
    return event.result && Object.hasOwn(event.result,'bytes')?Buffer.from(event.result.bytes,'base64'):structuredClone(event.result);
  };
  const config=new DmrvnConfig({...input.config,maxRelayCostWei:BigInt(input.config.maxRelayCostWei),deployment:DmrvnDeployment.fromManifest(input.config.deployment)});
  const rpc={async call(...args){return call('rpc',args);}};
  return {call,config,rpc,plain};
}
async function value() {
  switch(input.op) {
    case 'workflow': {
      const {call,config,rpc,plain}=replay();
      const operator={address:input.operator};for(const key of['signMessage','signTypedData','sendTransaction'])operator[key]=async(...args)=>call(key,args);
      const storage={address:input.storageAddress,chainId:config.greenfieldChainId};for(const key of['head','create','upload','read','matchesCreateTransaction'])storage[key]=async(...args)=>call('storage.'+key,args);
      const methodology=new DeclaredMethodology(Buffer.from(input.manifest),Buffer.from(input.wasm,'base64'),input.hash,()=>input.registryActive,input.schema);
      const journal=new MemoryOperationJournal();for(const [key,value]of Object.entries(input.seed??{}))await journal.store(key,value);
      const sdk=new DmrvnClient(config,rpc,operator,storage,methodology,journal),results=[];
      for(const step of input.actions){try{results.push({ok:true,value:plain(await sdk[step.method](...step.args))});}catch(e){results.push({ok:false,family:family(e),code:e.code??null});}}
      return results;
    }
    case 'reader': {
      const {call,config,rpc,plain}=replay();
      const reader=new DmrvnReader(config,rpc,{async read(...args){return call('report.read',args);}},{async resolve(...args){return call('report.resolve',args);}});
      return plain(await reader.readResult(...input.args));
    }
    case 'numberJson': {
      const view=new DataView(new ArrayBuffer(8));let number;
      if(input.single){view.setUint32(0,parseInt(input.bits,16));number=new Float32(view.getFloat32(0));}else{view.setBigUint64(0,BigInt('0x'+input.bits));number=new Float64(view.getFloat64(0));}
      return {canonical:Json.canonical(number),hash:Json.hash(number)};
    }
    case 'numberWire': {
      const view=new DataView(new ArrayBuffer(8));let number;
      if(input.single){view.setUint32(0,parseInt(input.bits,16));number=new Float32(view.getFloat32(0));}else{view.setBigUint64(0,BigInt('0x'+input.bits));number=new Float64(view.getFloat64(0));}
      const registration=BackendWalletRegistration.generate();const prepared=prepareAuthorization('app','https://api.privy.io',{number},registration.privateKey);
      return {canonical:canonicalPrivy059({number}),wire:prepared.bodyJson};
    }
    case 'float': {const view=new DataView(new ArrayBuffer(4));view.setUint32(0,parseInt(input.bits,16));return javaFloat(view.getFloat32(0));}
    case 'double': {const view=new DataView(new ArrayBuffer(8));view.setBigUint64(0,BigInt('0x'+input.bits));return javaDouble(view.getFloat64(0));}
    case 'json': { const parsed=Json.parse(Buffer.from(input.text));return {canonical:Json.canonical(parsed),hash:Json.hash(parsed)}; }
    case 'jwksUri':return String(PrivyTokenVerificationConfig.usingJwks(input.uri).clockSkew().toNanos());
    case 'privyOrigin':return new PrivyClientConfig('app','secret',input.uri).baseUri();
    case 'uri':return dmrvnUri(input.uri);
    case 'duration': { const d=Duration.ofSeconds(BigInt(input.seconds),BigInt(input.nanos));
      const seconds=d.nanoseconds>=0n?d.nanoseconds/1000000000n:(d.nanoseconds-999999999n)/1000000000n;
      return {milliseconds:String(d.toMillis()),negative:d.isNegative(),seconds:String(seconds),nanos:Number(d.nanoseconds-seconds*1000000000n)}; }
    case 'activity': { const r=new ActivityRequest(input.userId,input.sourceEventId,input.inputs,{claimId:input.claimId,objectName:input.objectName,gas:input.gas,
      confirmationTimeout:Duration.ofNanos(BigInt(input.timeoutNs)),pollInterval:Duration.ofNanos(BigInt(input.pollNs))});
      return {userId:r.userId,sourceEventId:r.sourceEventId,inputs:r.inputs,claimId:r.claimId,objectName:r.objectName,gas:r.gas,
        timeoutNs:String(r.confirmationTimeout.toNanos()),pollNs:String(r.pollInterval.toNanos())}; }
    case 'deployment':return DmrvnDeployment.fromManifest(input.manifest).snapshot();
    case 'methodology': { const d=new DeclaredMethodology(Buffer.from(input.manifest),Buffer.from(input.wasm,'base64'),input.hash,()=>true,input.schema);
      return d.evidenceBody(input.partner,input.beneficiary,input.event,input.inputs); }
    case 'protocol':switch(input.method) {
      case 'domain':return DmrvnProtocol.domain(input.chain,input.address,input.forwarder);
      case 'ownerHash':return DmrvnProtocol.ownerHash(input.address);
      case 'structHash':return DmrvnProtocol.structHash(input.type,input.message);
      case 'digest':return DmrvnProtocol.digest(input.type,input.domain,input.message);
      case 'recover':return DmrvnProtocol.recover(input.digest,input.signature);
    }break;
    case 'errors': {const e=new DmrvnError(input.code);return {code:e.code,retryable:e.retryable(),action:e.action(),definitelyNotBroadcast:e.definitelyNotBroadcast,definitelyRejected:e.definitelyRejected};}
    case 'query': {const q=new EvmTransactionQuery(BigInt(input.from),input.to==null?null:BigInt(input.to),input.limit,input.cursor);return {from:String(q.fromBlock),to:q.toBlock==null?null:String(q.toBlock),limit:q.limit,cursor:q.cursor};}
    case 'walletRequest': {const r=new BackendWalletCreateRequest(input.chainType,input.displayName,input.externalId);return {...r};}
    case 'asset': {const a=new AssetClient(rpc());if(input.method==='balance')return String(await a.getBalance(input.address));
      return a.transfer({address:input.address,async sendTransaction(chain,transaction,key){trace.push({send:String(chain),transaction,key});if(input.sendFails)throw new Error('send');return input.hash;}},input.recipient,BigInt(input.amount),input.key);}
    case 'transaction': {const t=new EvmTransactionClient(input.chain,rpc());
      if(input.method==='detail')return t.getTransaction(input.hash);
      if(input.method==='pages'){const results=[];for(const query of input.queries){try{results.push({ok:true,value:await t.listTransactions(input.address,query)});}catch(e){results.push({ok:false,family:family(e),code:e.code??null});}}return results;}
      const s=await t.getTransactionStatus(input.hash);
      return {chain:String(s.chainId),hash:s.transactionHash,state:s.state,block:s.blockNumber==null?null:String(s.blockNumber),confirmations:String(s.confirmations)};}
    case 'privy': {
      const client=new PrivyClient({appId:input.appId,appSecret:'test-secret',origin:input.endpoint});
      const registration=new BackendWalletRegistration(input.registration.publicKey,input.registration.privateKey),members=client.userWallets(registration,'service');
      switch(input.method){
        case 'verify':await client.verifyAppCredentials();return null;
        case 'register':return client.registerBackendWallet(registration,new BackendWalletCreateRequest('ethereum'));
        case 'list':return client.listWalletsByAuthorizationKey(registration.publicKey);
        case 'owned':return client.isBackendWallet(input.walletId,registration);
        case 'find':return members.findWallet('member');
        case 'signerMissing':return members.signerFor('member');
        case 'create':case 'createConflict':return members.getOrCreateWallet('member');
        case 'ensure': {const a=process.env.BACKEND_WALLET_PUBLIC_KEY,b=process.env.BACKEND_WALLET_PRIVATE_KEY;
          process.env.BACKEND_WALLET_PUBLIC_KEY=registration.publicKey;process.env.BACKEND_WALLET_PRIVATE_KEY=registration.privateKey;
          try{return await client.ensureBackendWallet(new BackendWalletCreateRequest('ethereum'));}finally{if(a===undefined)delete process.env.BACKEND_WALLET_PUBLIC_KEY;else process.env.BACKEND_WALLET_PUBLIC_KEY=a;if(b===undefined)delete process.env.BACKEND_WALLET_PRIVATE_KEY;else process.env.BACKEND_WALLET_PRIVATE_KEY=b;}}
      }break;
    }
    case 'jwtJwks': {const v=new PrivyTokenVerifier(input.appId,{jwksUrl:input.endpoint});const u=await v.verifyAccessToken(input.token);return {...u,issuedAtMs:String(u.issuedAtMs),expiresAtMs:String(u.expiresAtMs)};}
    case 'jwt': {const v=new PrivyTokenVerifier(input.appId,{publicKeyPem:input.pem});const u=await(input.header?v.authenticateAuthorizationHeader(input.token):v.verifyAccessToken(input.token));
      return {...u,issuedAtMs:String(u.issuedAtMs),expiresAtMs:String(u.expiresAtMs)};}
    case 'journal': {const j=new FileOperationJournal(input.directory);if(Object.hasOwn(input,'snapshot'))await j.withLock(input.key,()=>j.store(input.key,input.snapshot));for(let i=0;i<(input.increments??0);i++)await j.withLock(input.key,async()=>{const state=await j.load(input.key);await j.store(input.key,{count:(state?.count??0)+1});});return j.load(input.key);}
    case 'publicRead':return Buffer.from(await new GreenfieldPublicReader(input.endpoint,input.chain).read(input.location)).toString('base64');
  }
  throw new TypeError('Unknown operation');
}
for await (const line of createInterface({input:process.stdin})) {
  input=JSON.parse(line);trace=[];let out;
  try {out={ok:true,value:await value(),trace};}catch(e){out={ok:false,family:family(e),code:e.code??null,trace,...(e.name==='PrivyApiError'?{statusCode:e.statusCode,retryAfterMs:e.retryAfterMs===undefined?null:String(e.retryAfterMs)}:{})};}
  process.stdout.write(JSON.stringify(out,(_,v)=>typeof v==='bigint'?String(v):v)+'\n');
}
