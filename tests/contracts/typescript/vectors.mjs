import { EvmTransactionClient } from '../../../sdks/typescript/dist/index.js';
import { workflowVectors } from './workflow-vectors.mjs';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Json } from '../../../sdks/typescript/dist/index.js';
import { keccak } from '../../../sdks/typescript/dist/dmrvn-crypto.js';
const cases=[];const add=(name,op,data)=>cases.push({name,op,...data});
const address='0x'+'AB'.repeat(20),hash='0x'+'CD'.repeat(32);
for(const text of ['null','true','{}','[]','{"z":1,"a":[3,2,1]}','1.0','1e20','1e-7','9007199254740991','9007199254740992','9007199254740992.0','-0','-0.0','1.00000000000000001','{"x":1,"x":2}','[1,]','{}{}','"\\ud800"','{"\\u000f":"\\u000f"}', ...[128,129,500,999,1000,1001].map(n=>'['.repeat(n)+'0'+']'.repeat(n))])add('json '+cases.length,'json',{text});
for(const [seconds,nanos]of[['0','0'],['0','1'],['0','999999'],['0','1000001'],['-1','999999999'],['9223372036854775','807999999'],['9223372036854775','808000000'],['-9223372036854776','192000000']])add('duration '+cases.length,'duration',{seconds,nanos});
for(const uri of ['https://example.com/a/../b?q=%2e','https://example.com/%zz','https://example.com/a[b]','https://bad_host/a','https://한글.kr/a','https://localhost:65536/a','http://localhost:65536/a','https://localhost:2147483647','https://localhost:2147483648','https://localhost:/a','https://[fe80::1%eth0]/a','https://[::1]/a','https://299.0.0.1/a','https://a.1/a','https://example.com./a','https://-bad.com/a','https://123/a','https://example.com/한글','HTTPS://example.com/a','http://LOCALHOST/a','https://example.com/a|b','https://example.com/a%00b'])add('uri '+uri,'uri',{uri});
for(const uri of ['https://api.privy.io','HTTPS://API.PRIVY.IO','http://LOCALHOST','http://127.1','https://bad_host','https://한글.kr','https://localhost:65536','https://localhost:2147483647','https://localhost:2147483648','https://localhost:','https://[fe80::1%eth0]','https://[::1]','https://-bad.com','https://123','https://api.privy.io/','https://api.privy.io?','https://api.privy.io#'])add('privy origin '+uri,'privyOrigin',{uri});
for(const uri of ['HTTPS://EXAMPLE.COM/key','http://LOCALHOST/key?query=1','https://bad_host/key','https://example.com/%zz','https://localhost:65536/key','https://[fe80::1%eth0]/key','https://example.com/key?q=[x]','https://example.com/key#'])add('jwks uri '+uri,'jwksUri',{uri});
const activity={userId:' member ',sourceEventId:'event',inputs:{arbitrary:[null,1,'x']},claimId:null,objectName:null,gas:'900000',timeoutNs:'60000000000',pollNs:'1000000000'};
for(const delta of [{},{timeoutNs:'1'},{timeoutNs:'0',pollNs:'1000001'},{timeoutNs:'600000000001'},{pollNs:'999999'},{gas:'99999'},{gas:'2000000'},{gas:'0200000'},{userId:''},{sourceEventId:'bad/event'},{inputs:null},{claimId:hash}])add('activity '+cases.length,'activity',{...activity,...delta});
for(const code of ['INVALID_INPUT','EVIDENCE_CONTRACT_UNCONFIGURED','WRONG_CHAIN','DEPLOYMENT_MISMATCH','DEPLOYMENT_NOT_READY','UNAPPROVED_IMPLEMENTATION','DEPLOYMENT_COLLISION','UNAUTHORIZED_SIGNER','OPERATION_INPUT_CHANGED','OPERATION_NOT_PREPARED','SUBMISSION_INPUT_CHANGED','SUBMISSION_UNRESOLVED','STORAGE_ACCESS_DENIED','OBJECT_UNSEALED','STORAGE_UNAVAILABLE','STORAGE_CREATE_UNRESOLVED','STORAGE_ACCOUNT_UNFUNDED','STORAGE_MISMATCH','SIGNATURE_INVALID','REQUEST_EXPIRED','NONCE_CONFLICT','INSUFFICIENT_FUNDS','GAS_ESTIMATION_FAILED','RPC_UNAVAILABLE','REPORT_LOOKUP_RANGE','REPORT_TX_NOT_FOUND','REPORT_READ_FAILED','REPORT_MISMATCH','JOURNAL_UNAVAILABLE','INTERRUPTED','METHODOLOGY_UNAVAILABLE'])add('error '+code,'errors',{code});
for(const delta of [{},{from:'-1'},{limit:0},{limit:100},{limit:101},{cursor:''},{cursor:'x'.repeat(2049)},{from:'5',to:'4'}])add('query '+cases.length,'query',{from:'0',to:null,limit:20,cursor:null,...delta});
for(const delta of [{},{chainType:''},{displayName:'  ',externalId:'\t'},{externalId:' value '},{chainType:null}])add('wallet request '+cases.length,'walletRequest',{chainType:'ethereum',displayName:null,externalId:null,...delta});
for(const forwarder of[false,true])add('domain '+forwarder,'protocol',{method:'domain',chain:421614,address,forwarder});
for(const addr of[address,'0x'+'a'.repeat(40),'0x00','0x'+'aB'.repeat(20)])add('owner '+cases.length,'protocol',{method:'ownerHash',address:addr});
const rpc=[{method:'eth_chainId',result:'0x66eee'},{method:'eth_estimateGas',result:'0x5208'},{method:'eth_gasPrice',result:'0x2'},{method:'eth_getTransactionCount',result:'0x0'}];
for(const delta of[{}, {sendFails:true},{hash:'invalid'},{amount:'0'},{key:''},{rpc:[{method:'eth_chainId',result:'0x1'}]},{rpc:[rpc[0],{...rpc[1],result:'0x0'},...rpc.slice(2)]}])add('asset '+cases.length,'asset',{method:'transfer',address,recipient:'0x'+'12'.repeat(20),amount:'100000000000000000000',key:'operation',hash,rpc,...delta});
for(const result of['0x0','0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','0x00','0x1'+ '0'.repeat(64)])add('balance '+cases.length,'asset',{method:'balance',address,rpc:[rpc[0],{method:'eth_getBalance',result}]});
for(const error of[null,'INTERRUPTED','INVALID_INPUT','RPC_UNAVAILABLE'])add('status '+cases.length,'transaction',{method:'status',chain:421614,hash,rpc:[rpc[0],{method:'eth_getTransactionByHash',result:null,...(error?{error}:{})}]});
const wasm=Buffer.from([0,97,115,109,1,0,0,0]),manifest={activityId:1003,methodology:{id:2003,version:3},wasmHash:keccak(wasm)};
for(const inputs of[{}, {petBottleCount:3,extra:true},{any:[true,null,'value']}])for(const partner of[101,102])add('methodology '+cases.length,'methodology',{manifest:Json.canonical(manifest),hash:Json.hash(manifest),wasm:wasm.toString('base64'),schema:4,partner,beneficiary:address,event:'event',inputs});
for(const file of['deployment-testnet.json','deployment-direct-v7-testnet.json']){const manifest=JSON.parse(readFileSync(new URL('../../../sdks/java/src/main/resources/dmrvn/'+file,import.meta.url)));add('deployment '+file,'deployment',{manifest});add('bad deployment '+file,'deployment',{manifest:{...manifest,chainId:0}});}
const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),pem=publicKey.export({type:'spki',format:'pem'}).toString();
const now=Math.floor(Date.now()/1000),base={iss:'privy.io',aud:'app',sub:'did:privy:user',sid:'session',iat:now-60,exp:now+600};
const jwt=(header,payload)=>{const body=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload)).toString('base64url');return body+'.'+sign('sha256',Buffer.from(body),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');};
for(const payload of[base,{...base,aud:['app']},{...base,aud:['app','other']},{...base,exp:now-1},{...base,iat:now+300},{...base,linked_accounts:[]},{...base,exp:now+0.5},{...base,sid:''},JSON.stringify(base).replace('"sid":"session"','"sid":"first","sid":"session"')])add('jwt '+cases.length,'jwt',{appId:'app',pem,token:jwt({alg:'ES256',typ:'JWT'},payload)});
for(const header of[{alg:'ES256',typ:'jwt'},{alg:'ES256',typ:'JWT',crit:['x']},{alg:'ES256',typ:'JWT',kid:'x'.repeat(257)}])add('jwt header '+cases.length,'jwt',{appId:'app',pem,token:jwt(header,base)});
for(const token of[null,'',' Bearer x','bearer '+jwt({alg:'ES256',typ:'JWT'},base),'Bearer\twrong'])add('bearer '+cases.length,'jwt',{appId:'app',pem,token,header:true});
for(const depth of[128,129,500,999,1000,1001])add('jwt depth '+depth,'jwt',{appId:'app',pem,token:jwt({alg:'ES256',typ:'JWT'},JSON.stringify(base).slice(0,-1)+',"extra":'+'['.repeat(depth)+'0'+']'.repeat(depth)+'}')});
for(const exp of['9007199254740993','9007199254740993e0','9007199254740993.0',String(now+600)+'.0000000000000001'])add('jwt numeric '+exp,'jwt',{appId:'app',pem,token:jwt({alg:'ES256',typ:'JWT'},JSON.stringify({...base,iat:0}).replace(/"exp":\d+/, '"exp":'+exp))});
const normal=jwt({alg:'ES256',typ:'JWT'},base),segments=normal.split('.');
for(const token of[segments.map(v=>v+'='.repeat((4-v.length%4)%4)).join('.'), normal+' ',normal.replace(/-/g,'+').replace(/_/g,'/'),segments[0]+'.'+segments[1]+'.'+segments[2].slice(0,-1)+'!'])add('jwt compact '+cases.length,'jwt',{appId:'app',pem,token});
const tx={hash,from:address,to:'0x'+'12'.repeat(20),value:'0x20000000000001',nonce:'0x3',input:'0xaBcD',gas:'0x5208',gasPrice:'0x5',chainId:'0x66eee',blockNumber:'0xa',blockHash:'0x'+'11'.repeat(32),transactionIndex:'0x0',extra:{nested:['retained']}};
const receipt={transactionHash:hash,from:address,to:tx.to,blockNumber:tx.blockNumber,blockHash:tx.blockHash,transactionIndex:'0x0',status:'0x1',logs:[{data:'retained'}]};
for(const [label,transaction,proof]of[['success',tx,receipt],['reverted',tx,{...receipt,status:'0x0'}],['no-receipt',tx,null],['no-status',tx,{...receipt,status:null}],['bad-status',tx,{...receipt,status:'0x2'}],['bad-block',tx,{...receipt,blockHash:'0x'+'22'.repeat(32)}],['contract-creation',{...tx,to:null},{...receipt,to:null}],['pending',{...tx,blockNumber:null,blockHash:null,transactionIndex:null},null]])for(const method of['detail','status']) {
 const calls=[rpc[0],{method:'eth_getTransactionByHash',result:transaction}];if(transaction.blockNumber!==null)calls.push({method:'eth_getTransactionReceipt',result:proof},{method:'eth_blockNumber',result:'0xc'},{method:'eth_getBlockByNumber',result:{number:'0xa',hash:tx.blockHash}});
 add('transaction '+label+' '+method,'transaction',{method,chain:421614,hash,rpc:calls});
}
for(const scenario of['pages','empty-100-blocks','reorg','bad-cursor']) {
 const events=[],queries=[],height=scenario==='empty-100-blocks'?150:3;
 const h=n=>'0x'+BigInt(Math.max(0,n)+10000).toString(16).padStart(64,'0');const q=n=>'0x'+BigInt(n).toString(16);
 const blocks=new Map(Array.from({length:height+1},(_,n)=>[n,{number:q(n),hash:h(n),parentHash:h(n-1),transactions:[]}]));
 if(scenario==='pages')for(const n of[3,2,0])for(let idx=0;idx<2;idx++)blocks.get(n).transactions.push({...tx,hash:'0x'+BigInt(n*100+idx).toString(16).padStart(64,'0'),chainId:'0x1',blockNumber:q(n),blockHash:h(n),transactionIndex:q(idx)});
 let full=false;
 const transport={async call(method,params){let result;if(method==='eth_chainId')result='0x1';else if(method==='eth_blockNumber')result=q(height);else if(method==='eth_getBlockByNumber'){result=blocks.get(Number(BigInt(params[0])));if(params[1])full=true;else if(scenario==='reorg'&&full)result={...result,hash:h(999)};}else if(method==='eth_getTransactionReceipt'){const t=[...blocks.values()].flatMap(b=>b.transactions).find(t=>t.hash.toLowerCase()===params[0]);result={transactionHash:t.hash,from:t.from,to:t.to,blockNumber:t.blockNumber,blockHash:t.blockHash,transactionIndex:t.transactionIndex,status:'0x1'};}else throw new Error('RPC');events.push({method,result:structuredClone(result)});return result;}};
 const client=new EvmTransactionClient(1,transport);let cursor=scenario==='bad-cursor'?'invalid':null;
 for(let page=0;page<8;page++){const query={fromBlock:0,toBlock:null,limit:scenario==='pages'?1:100,cursor};queries.push(query);try{const result=await client.listTransactions(address,query);cursor=result.nextCursor;if(cursor===null)break;}catch{break;}}
 add('transaction '+scenario,'transaction',{method:'pages',chain:1,address,queries,rpc:events});
}
const dv=new DataView(new ArrayBuffer(8));
for(const value of[0,-0,0.1,1.5,1e20,1e23,1e-4,1e7,Number.MIN_VALUE,Number.MAX_VALUE,1e-323,Math.PI,9007199254740992,2.2250738585072014e-308]){dv.setFloat64(0,value);add('double '+value+' '+cases.length,'double',{bits:dv.getBigUint64(0).toString(16)});}
let randomBits=0x123456789abcdefn;for(let i=0;i<1000;i++){randomBits=BigInt.asUintN(64,randomBits*6364136223846793005n+1442695040888963407n);if((randomBits&0x7ff0000000000000n)!==0x7ff0000000000000n)add('double sample '+i,'double',{bits:randomBits.toString(16)});}
for(let bits=1n;bits<=1024n;bits++)add('double subnormal '+bits,'double',{bits:bits.toString(16)});
for(let exponent=1n;exponent<2047n;exponent++)add('double power '+exponent,'double',{bits:(exponent<<52n).toString(16)});
for(let bits=1;bits<=256;bits++)add('float subnormal '+bits,'float',{bits:bits.toString(16)});
for(let exponent=1;exponent<255;exponent++)add('float power '+exponent,'float',{bits:(BigInt(exponent)<<23n).toString(16)});
let floatBits=0x12345678;for(let i=0;i<1000;i++){floatBits=(Math.imul(floatBits,1664525)+1013904223)>>>0;if((floatBits&0x7f800000)!==0x7f800000)add('float sample '+i,'float',{bits:floatBits.toString(16)});}
for(const value of[0,-0,0.1,1.5,1e20,1e23,1e-4,1e7,Number.MIN_VALUE,Number.MAX_VALUE,NaN,Infinity,-Infinity]){dv.setFloat64(0,value);add('double wire '+value,'numberWire',{bits:dv.getBigUint64(0).toString(16),single:false});dv.setFloat32(0,value);add('float wire '+value,'numberWire',{bits:dv.getUint32(0).toString(16),single:true});}
for(const test of cases.filter(x=>x.op==='numberWire'))add(test.name+' DMRVN','numberJson',{bits:test.bits,single:test.single});
const registration={publicKey:pem.trimEnd(),privateKey:privateKey.export({type:'pkcs8',format:'pem'}).toString().trimEnd()};
const wallet={id:'wallet-1',address:'0x'+'11'.repeat(20),public_key:registration.publicKey,created_at:0,chain_type:'ethereum',external_id:'user_'+createHash('sha256').update('service\0member').digest('base64url'),policy_ids:[],owner_id:null,additional_signers:[],exported_at:null,imported_at:null};
for(const [method,responses]of[
 ['verify',[{data:[]}]],['register',[wallet]],['list',[{data:[wallet],next_cursor:'next'},{data:[],next_cursor:null}]],
 ['owned',[wallet]],['find',[{data:[]}]],['signerMissing',[{data:[]}]],['ensure',[{data:[]},{data:[wallet]}]],
 ['create',[{data:[]},wallet]],['createConflict',[{data:[]},{status:409,body:{}},{data:[wallet]}]],
 ['verify',[{status:401,body:{}}]],['verify',[{status:403,body:{}}]],['verify',[{status:429,body:{},headers:{'Retry-After':'5'}}]],
 ['verify',[{status:503,body:{}}]],['verify',[{raw:'not json'}]],['verify',[{}]],['verify',[null]],['verify',[{data:null}]],['find',[{}]],['find',[{data:null}]],['register',[{status:503,body:{}}]],
 ])add('privy '+method+' '+cases.length,'privy',{method,registration,responses,walletId:'wallet-1'});
const jwk=publicKey.export({format:'jwk'});
for(const keys of[[{...jwk,kid:'key'}],[{...jwk,x:jwk.x+'=',y:jwk.y+'='}],[{...jwk,alg:'ES384'}],[{...jwk,use:'enc'}],[{...jwk,crv:'P-384'}],[],[{kty:'unsupported'}]])add('jwks '+cases.length,'jwtJwks',{appId:'app',token:normal,jwks:{keys}});
add('jwks redirect','jwtJwks',{appId:'app',token:normal,jwks:{keys:[jwk]},redirect:true});
for(const objectName of['plain','a/./b','a/../b','../report','한글/space value','a//b','%2e%2e/path'])add('public URI '+cases.length,'publicRead',{chain:'5600',location:{storageType:1,chainId:'5600',bucketName:'bucket',objectName}});
cases.push(...await workflowVectors());
process.stdout.write(JSON.stringify(cases));
